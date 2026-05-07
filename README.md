# Contel Portal

Portal unificado com todas as ferramentas Contel.

## Ferramentas
- **Portal** → `/` — Hub principal
- **Dashboard Gerencial** → `/dashboard`
- **Organizador Pessoal** → `/organizador`
- **OS Romaneio** → `/os-romaneio`
- **Ordem de Serviço** → `/ordem-de-servico`
- **Cronograma Obras** → `/cronograma`
- **Pipeline** → `/pipeline`

## Deploy no Render
1. Suba este repositório no GitHub
2. No Render: New → Blueprint → conecte o repositório
3. O `render.yaml` configura tudo automaticamente (web service + PostgreSQL)

## Usuários
| Usuário | Senha | Nível |
|---------|-------|-------|
| admin | contel@2024 | Admin |
| planejamento | planejamento1 | Admin |
| obras | obras1 | Leitura |

Altere as senhas via variável `ADMIN_PASS` no Render.
