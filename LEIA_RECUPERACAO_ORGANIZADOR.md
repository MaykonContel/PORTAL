# Proteção contra perda de dados — Organizador Pessoal

Esta versão corrige o problema de sobrescrever o organizador com estado vazio.

## O que foi alterado

1. O servidor agora cria a tabela `organizador_snapshots` automaticamente.
2. Antes de cada salvamento, o estado anterior é copiado para `organizador_snapshots`.
3. Se o navegador tentar salvar um organizador vazio em cima de dados existentes, o servidor bloqueia a gravação com erro 409.
4. O HTML agora mantém backups locais rotativos no navegador:
   - `contel_v8`
   - `contel_v8_last_good`
   - `contel_v8_backups`
5. Se o servidor retornar vazio, o HTML tenta carregar o último backup local antes de renderizar tudo em branco.

## Como ver backups no Supabase

```sql
select id, usuario, motivo, created_at, left(data, 300) as previa
from organizador_snapshots
order by id desc;
```

## Como restaurar direto via SQL

Troque o número do `id` pelo snapshot correto:

```sql
update organizador o
set data = s.data,
    updated_at = now()::text
from organizador_snapshots s
where o.usuario = s.usuario
  and o.usuario = 'admin'
  and s.id = 123;
```

## Como conferir o estado atual

```sql
select usuario, updated_at, data
from organizador;
```

## Observação importante

Esta proteção passa a valer depois do novo deploy. Ela não consegue recuperar automaticamente dados que já foram sobrescritos antes da existência da tabela de snapshots.
