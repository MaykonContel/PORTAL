import os
import re
import json
import secrets
import hashlib
import hmac
import urllib.request
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from urllib.parse import urlparse, unquote
from flask import Flask, Blueprint, jsonify, request, send_from_directory, redirect, make_response

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL", "")
BASE_DIR     = os.path.dirname(os.path.abspath(__file__))

SESSION_SECRET = os.environ.get("SESSION_SECRET", secrets.token_hex(32))
SESSION_COOKIE = "contel_session"
SESSION_HOURS  = int(os.environ.get("SESSION_HOURS", "12"))

USERS = {
    "planejamento": {"password": "planejamento1", "role": "admin",  "display": "Planejamento"},
    "obras":        {"password": "obras1",         "role": "viewer", "display": "Obras"},
    "admin":        {"password": os.environ.get("ADMIN_PASS", "contel@2024"), "role": "admin", "display": "Admin"},
}

# ── Auth ───────────────────────────────────────────────────────────────────────
def _make_token(user):
    ts  = str(int(datetime.now().timestamp()))
    msg = f"{ts}:{user}"
    sig = hmac.new(SESSION_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return f"{msg}:{sig}"

def _verify_token(token):
    try:
        ts_str, user, sig = token.rsplit(":", 2)
        msg      = f"{ts_str}:{user}"
        expected = hmac.new(SESSION_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected): return None
        if (datetime.now().timestamp() - int(ts_str)) / 3600 > SESSION_HOURS: return None
        return user if user in USERS else None
    except Exception:
        return None

def _current_user():
    token = request.cookies.get(SESSION_COOKIE, "")
    return _verify_token(token) if token else None

def _require_auth():
    if _current_user(): return None
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Não autenticado", "login_required": True}), 401
    return redirect(f"/login?next={request.path}")

def _require_admin():
    user = _current_user()
    if not user:
        return jsonify({"ok": False, "error": "Não autenticado", "login_required": True}), 401
    if USERS[user]["role"] != "admin":
        return jsonify({"ok": False, "error": "Sem permissão."}), 403
    return None

# ── DB ─────────────────────────────────────────────────────────────────────────
def _parse_db_url(url):
    p = urlparse(url)
    return {"host": p.hostname, "port": p.port or 5432,
            "dbname": p.path.lstrip("/"),
            "user": unquote(p.username or ""),
            "password": unquote(p.password or ""),
            "sslmode": "require"}

def get_db():
    conn = psycopg2.connect(cursor_factory=psycopg2.extras.RealDictCursor,
                             **_parse_db_url(DATABASE_URL))
    _init_tables(conn)
    return conn

def _init_tables(conn):
    with conn.cursor() as cur:
        cur.execute("""
            -- Dashboard store
            CREATE TABLE IF NOT EXISTS store (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS historico (
                id         SERIAL PRIMARY KEY,
                id_site    TEXT NOT NULL,
                campo      TEXT NOT NULL,
                valor_ant  TEXT,
                valor_novo TEXT,
                usuario    TEXT DEFAULT 'dashboard',
                criado_em  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS filtros_favoritos (
                id        SERIAL PRIMARY KEY,
                nome      TEXT NOT NULL UNIQUE,
                payload   TEXT NOT NULL,
                criado_em TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS geocache (
                key TEXT PRIMARY KEY,
                lat REAL,
                lon REAL
            );
            -- Organizador Pessoal
            CREATE TABLE IF NOT EXISTS organizador (
                usuario   TEXT PRIMARY KEY,
                data      TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)
    conn.commit()

def now_iso():
    return datetime.now().isoformat(timespec="seconds")

# ── Dashboard store helpers ────────────────────────────────────────────────────
def default_store():
    return {"parsed": [], "cronMap": {}, "inicioMap": {}, "reprogMap": {},
            "etapasList": [], "equipeMap": {}, "etapaObraMap": {},
            "statusPrazoMap": {}, "saved_at": None, "sync_status": "empty"}

def _apply_historico(parsed, conn):
    CAMPOS = ["status_prazo","etapa_obra","observacoes","etapa","analista","maps_link"]
    try:
        editados = {}
        with conn.cursor() as cur:
            cur.execute("SELECT id_site, campo, valor_novo FROM historico WHERE campo = ANY(%s) ORDER BY id", (CAMPOS,))
            for r in cur.fetchall():
                editados.setdefault(r["id_site"], {})[r["campo"]] = r["valor_novo"]
        if not editados: return parsed
        for obra in parsed:
            id_s = str(obra.get("id_site","")).strip().upper()
            if id_s in editados:
                for campo, val_json in editados[id_s].items():
                    try:    obra[campo] = json.loads(val_json)
                    except: obra[campo] = val_json
    except Exception as e:
        print(f"[apply_historico] {e}")
    return parsed

def load_store():
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("SELECT key, value FROM store")
            rows = cur.fetchall()
        data = default_store()
        for row in rows:
            try: data[row["key"]] = json.loads(row["value"])
            except: pass
        data["parsed"] = _apply_historico(data.get("parsed", []), conn)
        conn.close()
        return data
    except Exception:
        return default_store()

def save_store(data):
    conn = get_db()
    with conn.cursor() as cur:
        for key, value in data.items():
            cur.execute("INSERT INTO store (key,value) VALUES (%s,%s) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
                        (key, json.dumps(value, ensure_ascii=False)))
    conn.commit()
    conn.close()
    _embed_data_in_html(data)

def _embed_data_in_html(data):
    try:
        dash_path = os.path.join(BASE_DIR, "dashboard.html")
        if not os.path.isfile(dash_path): return
        with open(dash_path, "r", encoding="utf-8") as f: content = f.read()
        embed = {k: data.get(k) for k in ["parsed","cronMap","inicioMap","reprogMap","etapasList","equipeMap","etapaObraMap","statusPrazoMap","saved_at"]}
        json_str  = json.dumps(embed, ensure_ascii=False, separators=(",",":"))
        tag_open  = '<script id="embedded-data" type="application/json">'
        tag_close = "</script>"
        start = content.find(tag_open)
        if start == -1: return
        end_tag = content.find(tag_close, start)
        if end_tag == -1: return
        new_content = content[:start+len(tag_open)] + "\n" + json_str + "\n" + content[end_tag:]
        if new_content != content:
            with open(dash_path, "w", encoding="utf-8") as f: f.write(new_content)
    except Exception as e:
        print(f"[embed] {e}")

SMTP_HOST  = os.environ.get("SMTP_HOST","")
SMTP_PORT  = int(os.environ.get("SMTP_PORT","587"))
SMTP_USER  = os.environ.get("SMTP_USER","")
SMTP_PASS  = os.environ.get("SMTP_PASS","")
EMAIL_FROM = os.environ.get("EMAIL_FROM", SMTP_USER)

def _send_email(to_list, subject, html_body):
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS: return False,"SMTP não configurado"
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"]=subject; msg["From"]=EMAIL_FROM; msg["To"]=", ".join(to_list)
        msg.attach(MIMEText(html_body,"html","utf-8"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.ehlo(); s.starttls(); s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(EMAIL_FROM, to_list, msg.as_string())
        return True,"ok"
    except Exception as e: return False,str(e)

# ── Flask ──────────────────────────────────────────────────────────────────────
app = Flask(__name__)
api = Blueprint("api", __name__, url_prefix="/api")

@app.after_request
def no_cache(response):
    response.headers["Cache-Control"] = "no-store,no-cache,must-revalidate,max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response

@api.before_request
def api_auth_check():
    if request.endpoint == "api.api_health": return None
    # Organizador: qualquer usuário autenticado pode acessar seus próprios dados
    return _require_auth()

# ── Health ─────────────────────────────────────────────────────────────────────
@api.get("/health")
def api_health():
    data = load_store()
    return jsonify({"ok":True,"records":len(data.get("parsed",[])),"saved_at":data.get("saved_at"),"db":"postgresql"})

@api.get("/me")
def api_me():
    user = _current_user()
    if not user: return jsonify({"ok":False}),401
    u = USERS[user]
    return jsonify({"ok":True,"user":user,"display":u["display"],"role":u["role"]})

# ── Dashboard APIs ─────────────────────────────────────────────────────────────
@api.get("/data")
def api_data():
    return jsonify(load_store())

@api.post("/save")
def api_save():
    guard = _require_admin()
    if guard: return guard
    payload = request.get_json(silent=True)
    if not isinstance(payload,dict): return jsonify({"ok":False,"error":"JSON inválido"}),400
    data = default_store()
    for k in data:
        if k in payload: data[k] = payload[k]
    data["saved_at"] = now_iso(); data["sync_status"] = "synced"
    save_store(data)
    return jsonify({"ok":True,"saved_at":data["saved_at"],"records":len(data.get("parsed",[]))})

@api.post("/save-merge")
def api_save_merge():
    guard = _require_admin()
    if guard: return guard
    payload = request.get_json(silent=True)
    if not isinstance(payload,dict): return jsonify({"ok":False,"error":"JSON inválido"}),400
    try:
        conn = get_db()
        CAMPOS = ["status_prazo","etapa_obra","observacoes","etapa","analista","maps_link"]
        editados = {}
        with conn.cursor() as cur:
            cur.execute("SELECT id_site, campo, valor_novo FROM historico WHERE campo = ANY(%s) ORDER BY id",(CAMPOS,))
            for r in cur.fetchall():
                editados.setdefault(r["id_site"],{})[r["campo"]] = r["valor_novo"]
        conn.close()
        store_ant  = load_store()
        parsed_ant = {str(o.get("id_site","")).strip().upper():o for o in store_ant.get("parsed",[])}
        novos = payload.get("parsed",[])
        for obra in novos:
            id_s = str(obra.get("id_site","")).strip().upper()
            if id_s in editados:
                for campo,valor in editados[id_s].items():
                    try:    obra[campo] = json.loads(valor)
                    except: obra[campo] = valor
            elif id_s in parsed_ant:
                for campo in CAMPOS:
                    if parsed_ant[id_s].get(campo) and not obra.get(campo):
                        obra[campo] = parsed_ant[id_s][campo]
        payload["parsed"] = novos
        data = default_store()
        for k in data:
            if k in payload: data[k] = payload[k]
        data["saved_at"] = now_iso(); data["sync_status"] = "synced"
        save_store(data)
        return jsonify({"ok":True,"saved_at":data["saved_at"],"records":len(novos),"merged":len(editados)})
    except Exception as e:
        return jsonify({"ok":False,"error":str(e)}),500

@api.post("/reset")
def api_reset():
    guard = _require_admin()
    if guard: return guard
    conn = get_db()
    with conn.cursor() as cur: cur.execute("DELETE FROM store")
    conn.commit(); conn.close()
    return jsonify({"ok":True})

@api.post("/obra/editar")
def api_obra_editar():
    guard = _require_admin()
    if guard: return guard
    body    = request.get_json(silent=True) or {}
    id_site = str(body.get("id_site","")).strip().upper()
    campo   = str(body.get("campo","")).strip()
    valor   = body.get("valor")
    usuario = _current_user() or "dashboard"
    if not id_site or not campo:
        return jsonify({"ok":False,"error":"id_site e campo obrigatórios"}),400
    data   = load_store()
    parsed = data.get("parsed",[])
    valor_ant       = None
    obra_encontrada = False
    for obra in parsed:
        if str(obra.get("id_site","")).strip().upper() == id_site:
            valor_ant = obra.get(campo); obra[campo] = valor; obra_encontrada = True; break
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute("INSERT INTO historico (id_site,campo,valor_ant,valor_novo,usuario,criado_em) VALUES (%s,%s,%s,%s,%s,%s)",
                    (id_site,campo,json.dumps(valor_ant,ensure_ascii=False),json.dumps(valor,ensure_ascii=False),usuario,now_iso()))
    conn.commit(); conn.close()
    if obra_encontrada:
        data["parsed"] = parsed; data["saved_at"] = now_iso()
        save_store(data)
        return jsonify({"ok":True,"id_site":id_site,"campo":campo})
    return jsonify({"ok":True,"id_site":id_site,"campo":campo,"needs_sync":True})

@api.get("/obra/historico/<id_site>")
def api_obra_historico(id_site):
    id_site = id_site.strip().upper()
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute("SELECT campo,valor_ant,valor_novo,usuario,criado_em FROM historico WHERE id_site=%s ORDER BY id DESC LIMIT 50",(id_site,))
        rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@api.get("/filtros-favoritos")
def api_filtros_get():
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute("SELECT id,nome,payload,criado_em FROM filtros_favoritos ORDER BY id")
        rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@api.post("/filtros-favoritos")
def api_filtros_save():
    guard = _require_admin()
    if guard: return guard
    body = request.get_json(silent=True) or {}
    nome = str(body.get("nome","")).strip()
    payload = body.get("payload",{})
    if not nome: return jsonify({"ok":False,"error":"nome obrigatório"}),400
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute("INSERT INTO filtros_favoritos (nome,payload,criado_em) VALUES (%s,%s,%s) ON CONFLICT (nome) DO UPDATE SET payload=EXCLUDED.payload",
                    (nome,json.dumps(payload,ensure_ascii=False),now_iso()))
    conn.commit(); conn.close()
    return jsonify({"ok":True})

@api.delete("/filtros-favoritos/<int:fid>")
def api_filtros_delete(fid):
    guard = _require_admin()
    if guard: return guard
    conn = get_db()
    with conn.cursor() as cur: cur.execute("DELETE FROM filtros_favoritos WHERE id=%s",(fid,))
    conn.commit(); conn.close()
    return jsonify({"ok":True})

@api.get("/geocache")
def api_geocache_get():
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute("SELECT key,lat,lon FROM geocache")
        rows = cur.fetchall()
    conn.close()
    return jsonify({r["key"]:{"lat":r["lat"],"lon":r["lon"]} for r in rows})

@api.post("/geocache")
def api_geocache_save():
    body = request.get_json(silent=True) or {}
    if not isinstance(body,dict): return jsonify({"ok":False}),400
    conn = get_db()
    with conn.cursor() as cur:
        for k,v in body.items():
            if isinstance(v,dict) and "lat" in v and "lon" in v:
                cur.execute("INSERT INTO geocache (key,lat,lon) VALUES (%s,%s,%s) ON CONFLICT (key) DO UPDATE SET lat=EXCLUDED.lat,lon=EXCLUDED.lon",
                            (k,v["lat"],v["lon"]))
    conn.commit(); conn.close()
    return jsonify({"ok":True})

@api.get("/geocode")
def api_geocode():
    url = request.args.get("url","").strip()
    if not url: return jsonify({"ok":False,"error":"url obrigatório"}),400
    def extract_coords(u):
        for pat in [r"@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)",r"[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)",
                    r"ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)",r"/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)"]:
            m = re.search(pat,u)
            if m: return float(m.group(1)),float(m.group(2))
        return None
    c = extract_coords(url)
    if c: return jsonify({"ok":True,"lat":c[0],"lon":c[1],"resolved_url":url})
    headers={"User-Agent":"Mozilla/5.0"}; current_url=url; visited=set(); final_url=url
    for _ in range(5):
        if current_url in visited: break
        visited.add(current_url)
        req=urllib.request.Request(current_url,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=10) as resp:
                final_url=resp.url; c=extract_coords(final_url)
                if c: return jsonify({"ok":True,"lat":c[0],"lon":c[1],"resolved_url":final_url})
                break
        except urllib.error.HTTPError as e:
            loc=e.headers.get("Location","")
            if loc:
                c=extract_coords(loc)
                if c: return jsonify({"ok":True,"lat":c[0],"lon":c[1],"resolved_url":loc})
                current_url=final_url=loc
            else: break
    c=extract_coords(final_url)
    if c: return jsonify({"ok":True,"lat":c[0],"lon":c[1],"resolved_url":final_url})
    return jsonify({"ok":False,"error":"Coordenadas não encontradas","resolved_url":final_url})

# ── Organizador Pessoal API ────────────────────────────────────────────────────
@api.get("/organizador")
def api_organizador_get():
    user = _current_user()
    if not user: return jsonify({"ok":False}),401
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM organizador WHERE usuario=%s",(user,))
            row = cur.fetchone()
        conn.close()
        if row:
            return jsonify({"ok":True,"data":json.loads(row["data"])})
        return jsonify({"ok":True,"data":None})
    except Exception as e:
        return jsonify({"ok":False,"error":str(e)}),500

@api.post("/organizador")
def api_organizador_save():
    user = _current_user()
    if not user: return jsonify({"ok":False}),401
    body = request.get_json(silent=True)
    if body is None: return jsonify({"ok":False,"error":"JSON inválido"}),400
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO organizador (usuario,data,updated_at) VALUES (%s,%s,%s)
                           ON CONFLICT (usuario) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at""",
                        (user, json.dumps(body,ensure_ascii=False), now_iso()))
        conn.commit(); conn.close()
        return jsonify({"ok":True,"updated_at":now_iso()})
    except Exception as e:
        return jsonify({"ok":False,"error":str(e)}),500

@api.route("/<path:path>", methods=["GET","POST","DELETE"])
def api_not_found(path):
    return jsonify({"ok":False,"error":"Rota não encontrada"}),404

app.register_blueprint(api)

# ── Login/Logout ───────────────────────────────────────────────────────────────
LOGIN_HTML = '''<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login — Contel</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a1628;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif}.card{background:#111e35;border:1px solid #1e3a5f;border-radius:18px;padding:42px 40px;width:360px;box-shadow:0 24px 80px rgba(0,0,0,.6)}.logo{text-align:center;margin-bottom:32px}.logo-icon{width:52px;height:52px;background:linear-gradient(135deg,#1a56db,#1e40af);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:#fff;margin-bottom:12px}.logo h1{font-size:20px;font-weight:800;color:#fff}.logo p{font-size:12px;color:#4a6080;margin-top:4px}label{display:block;font-size:11px;font-weight:700;color:#4a6080;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px}input{width:100%;background:#0d1b30;border:1.5px solid #1e3a5f;border-radius:10px;padding:11px 14px;font-size:14px;color:#fff;outline:none;margin-bottom:16px}input:focus{border-color:#1a56db}button{width:100%;background:#1a56db;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;margin-top:4px}button:hover{background:#1d4ed8}.error{background:rgba(244,63,94,.12);border:1px solid rgba(244,63,94,.3);color:#f43f5e;border-radius:9px;padding:10px 14px;font-size:13px;margin-bottom:16px;text-align:center}</style></head><body><div class="card"><div class="logo"><div class="logo-icon">C</div><h1>Con<span style="color:#f0c040">tel</span></h1><p>Portal Contel</p></div>{error_block}<form method="POST" action="/login"><input type="hidden" name="next" value="{next_url}"><label>Usuário</label><input type="text" name="username" autocomplete="username" autofocus required><label>Senha</label><input type="password" name="password" autocomplete="current-password" required><button type="submit">Entrar →</button></form></div></body></html>'''

@app.get("/login")
def login_page():
    if _current_user(): return redirect("/")
    next_url = request.args.get("next","/")
    return LOGIN_HTML.replace("{error_block}","").replace("{next_url}",next_url),200,{"Content-Type":"text/html;charset=utf-8"}

@app.post("/login")
def login_submit():
    username  = request.form.get("username","").strip().lower()
    password  = request.form.get("password","")
    next_url  = request.form.get("next","/") or "/"
    user_data = USERS.get(username)
    if user_data and hmac.compare_digest(password, user_data["password"]):
        resp = make_response(redirect(next_url))
        resp.set_cookie(SESSION_COOKIE, _make_token(username),
                        max_age=SESSION_HOURS*3600, httponly=True, samesite="Lax",
                        secure=os.environ.get("HTTPS","")=="true")
        return resp
    return LOGIN_HTML.replace("{error_block}",'<div class="error">Usuário ou senha incorretos.</div>').replace("{next_url}",next_url),401,{"Content-Type":"text/html;charset=utf-8"}

@app.get("/logout")
def logout():
    resp = make_response(redirect("/login"))
    resp.delete_cookie(SESSION_COOKIE)
    return resp

# ── Static / Pages ─────────────────────────────────────────────────────────────
# Mapa de rotas limpas → arquivos HTML
ROUTE_MAP = {
    "/":                       "portal-contel.html",
    "/portal":                 "portal-contel.html",
    "/dashboard":              "dashboard.html",
    "/organizador":            "organizador-pessoal.html",
    "/os-romaneio":            "OS_Romaneio.html",
    "/ordem-de-servico":       "ordem-de-servico-contel.html",
    "/cronograma":             "cronograma_obras.html",
    "/pipeline":               "contel_v3.html",
}

@app.route("/<path:path>")
def static_files(path):
    if path in ("login","logout"): return redirect(f"/{path}")
    guard = _require_auth()
    if guard: return guard
    full = os.path.join(BASE_DIR, path)
    if os.path.isfile(full): return send_from_directory(BASE_DIR, path)
    return send_from_directory(BASE_DIR, "portal-contel.html")

@app.get("/")
def home():
    guard = _require_auth()
    if guard: return guard
    return send_from_directory(BASE_DIR, "portal-contel.html")

# Rotas limpas
for _route, _file in ROUTE_MAP.items():
    if _route in ("/",""):
        continue
    def _make_view(f):
        def _view():
            guard = _require_auth()
            if guard: return guard
            return send_from_directory(BASE_DIR, f)
        _view.__name__ = "route_" + f.replace(".","_").replace("-","_")
        return _view
    app.add_url_rule(_route, view_func=_make_view(_file))

if __name__ == "__main__":
    port = int(os.environ.get("PORT",8000))
    app.run(host="0.0.0.0", port=port, debug=False)
