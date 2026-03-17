Crie um projeto completo de Tally Light Web para OBS, com foco em uso no celular pelo navegador, arquitetura simples, modular e pronta para evoluir.

Objetivo do sistema

O sistema deve funcionar como um Tally Light mobile web para operadores de câmera.

Cada dispositivo acessará uma URL com um deviceId, por exemplo:

/tally/cam01

/tally/cam02

Cada deviceId será vinculado a uma source/câmera do OBS.

A interface deve fazer apenas isso:

mostrar no centro da tela o preview do Program do OBS

acender uma borda verde quando a source vinculada àquele device estiver ao vivo

mostrar estado de desconexão quando perder conexão com o servidor

Não criar painel complexo, mixer, botões de corte, troca de cena ou funcionalidades extras no MVP.

Stack obrigatória
Backend

Node.js

TypeScript

Fastify ou Express

WebSocket server

integração com OBS via obs-websocket

persistência simples por JSON no MVP

Frontend

React

TypeScript

Vite

layout mobile-first

preparado para rodar bem no navegador do celular

PWA opcional, mas a prioridade inicial é funcionar bem no browser

Arquitetura obrigatória
Regra geral

O frontend não deve se conectar diretamente ao OBS.

Criar um companion server/backend que:

conecta ao OBS via WebSocket

lê estado inicial

escuta eventos do OBS em tempo real

calcula o estado onAir por device

envia atualizações para os clientes web por WebSocket

fornece ou repassa uma previewUrl

Separação de responsabilidades
Backend

Responsável por:

conexão com o OBS

lógica de tally

mapeamento deviceId -> sourceName

estado global

websocket com clientes

configuração

Frontend

Responsável por:

identificar o deviceId

conectar no websocket do backend

receber estado do tally

renderizar o preview

atualizar a borda da tela

Regra de negócio
Mapeamento

Cada device deve ser vinculado a uma source do OBS.

Exemplo de configuração:

{
  "obs": {
    "host": "127.0.0.1",
    "port": 4455,
    "password": "123456"
  },
  "preview": {
    "url": "https://preview.local/program"
  },
  "devices": [
    {
      "deviceId": "cam01",
      "sourceName": "CAM1"
    },
    {
      "deviceId": "cam02",
      "sourceName": "CAM2"
    },
    {
      "deviceId": "cam03",
      "sourceName": "CAM3"
    }
  ]
}
Regra para onAir

Um device deve ser considerado onAir = true quando:

a sourceName vinculada ao deviceId

estiver presente na cena atual em Program

e estiver visível/renderizada

Caso contrário:

onAir = false

Importante:

não basear a lógica apenas no nome da cena

verificar a visibilidade real da source vinculada no Program

Fluxo esperado
Fluxo do backend

iniciar servidor

carregar config JSON

conectar no OBS

obter estado inicial

monitorar eventos do OBS

recalcular tally quando houver mudança relevante

notificar clientes conectados

Fluxo do frontend

abrir URL /tally/:deviceId

extrair o deviceId

conectar no WebSocket do backend

enviar mensagem de registro com esse deviceId

receber estado inicial

mostrar preview central

alterar borda conforme onAir

Contrato de comunicação via WebSocket
Cliente -> servidor

Ao conectar, o cliente deve enviar:

{
  "type": "register",
  "deviceId": "cam01"
}
Servidor -> cliente

Estado inicial:

{
  "type": "init",
  "deviceId": "cam01",
  "sourceName": "CAM1",
  "onAir": false,
  "previewUrl": "/api/preview",
  "connectedToObs": true
}

Atualização de tally:

{
  "type": "tally",
  "deviceId": "cam01",
  "onAir": true
}

Atualização de status:

{
  "type": "status",
  "connectedToObs": true
}
Requisitos da interface
Tela única

Criar uma única tela, extremamente simples.

Layout

fundo preto

preview central ocupando quase toda a área útil

borda grossa em volta da tela inteira

texto pequeno opcional com nome do device/source

badge pequeno opcional com status de conexão

Estados visuais

onAir = true -> borda verde forte

onAir = false -> borda escura/preta/cinza escuro

disconnected = true -> indicador vermelho discreto ou borda vermelha discreta

UX mobile

layout mobile-first

funcionar bem em Android

suportar retrato e paisagem

sem elementos visuais desnecessários

reação rápida às mudanças

Preview de vídeo

O preview não deve vir do obs-websocket.

O sistema deve ser projetado para aceitar uma previewUrl externa/configurável.

No MVP:

abstrair o preview como uma URL configurável

renderizar o preview no frontend

deixar a camada preparada para futura integração com WebRTC ou outro método

Criar um componente de preview desacoplado da lógica de tally.

Estrutura sugerida do projeto
obs-tally-web/
  apps/
    server/
      src/
        index.ts
        config/
          appConfig.ts
          devices.json
        obs/
          obsClient.ts
          tallyEngine.ts
          sceneResolver.ts
        ws/
          wsServer.ts
          wsTypes.ts
        http/
          routes.ts
        services/
          stateStore.ts
          previewService.ts
    web/
      src/
        main.tsx
        App.tsx
        pages/
          TallyPage.tsx
          SetupPage.tsx
        components/
          PreviewPlayer.tsx
          TallyFrame.tsx
          ConnectionBadge.tsx
        services/
          socketClient.ts
          api.ts
          deviceResolver.ts
        hooks/
          useTallyState.ts
        styles/
  packages/
    shared/
      types/

Se quiser simplificar, pode fazer sem monorepo, mas manter boa separação entre backend e frontend.

Estrutura lógica esperada
Backend
obsClient

Deve:

conectar ao OBS

autenticar

reconectar automaticamente

obter cena em Program

obter sources/scene items

escutar eventos relevantes

tallyEngine

Deve:

ler o mapeamento dos devices

calcular onAir por deviceId

emitir atualização apenas quando houver mudança real

ser desacoplado da camada WebSocket

stateStore

Deve:

armazenar estado atual do OBS

armazenar estado atual dos devices

permitir leitura consistente pelo restante do sistema

wsServer

Deve:

aceitar conexões dos clientes

registrar device por conexão

enviar estado inicial

reenviar updates em tempo real

tratar reconexão e limpeza de conexões mortas

previewService

Deve:

expor a origem atual do preview

abstrair a previewUrl

permitir trocar a tecnologia do preview depois sem refatorar o frontend

Frontend
deviceResolver

Deve:

extrair o deviceId da URL

validar presença do deviceId

opcionalmente salvar em localStorage

socketClient

Deve:

conectar ao backend

enviar register

receber init, tally e status

reconectar automaticamente

TallyPage

Deve:

coordenar o estado da página

renderizar preview

renderizar borda dinâmica

mostrar fallback de erro

PreviewPlayer

Deve:

receber previewUrl

exibir o vídeo/preview central

se adaptar a celular

suportar autoplay quando possível

TallyFrame

Deve:

aplicar as classes/estilos visuais da borda conforme o estado

Rotas esperadas
Frontend

/tally/:deviceId

Exemplo:

/tally/cam01

Backend HTTP

GET /api/health

GET /api/device/:deviceId

GET /api/config

GET /api/preview

WebSocket

endpoint /ws

Persistência

No MVP, usar JSON.

Arquivos esperados:

devices.json

app-config.json

Não criar banco complexo neste momento.

Requisitos técnicos obrigatórios
Reconexão

backend deve reconectar ao OBS automaticamente

frontend deve reconectar ao backend automaticamente

Segurança mínima

senha do OBS nunca deve ir para o frontend

frontend só fala com o backend

integração com o OBS sempre isolada no servidor

Estabilidade

não perder estado facilmente

se o OBS desconectar, atualizar clientes com status correto

se reconectar, restaurar comportamento normal automaticamente

Código

TypeScript bem tipado

código limpo

modularização clara

evitar acoplamento excessivo

evitar complexidade desnecessária

Entregáveis obrigatórios

backend funcional em Node.js + TypeScript

frontend funcional em React + TypeScript

integração com OBS funcional

cálculo real de tally por deviceId

preview central renderizado via previewUrl

WebSocket funcionando entre backend e frontend

README com setup completo

arquivo de exemplo de configuração

instruções para rodar em rede local e acessar pelo celular

Critérios de aceite

O projeto será aceito quando:

eu abrir /tally/cam01 no celular

o sistema reconhecer que cam01 está vinculado à source CAM1

o preview aparecer no centro da tela

quando CAM1 estiver no ar no OBS, a borda ficar verde

quando CAM1 sair do ar, a borda voltar ao estado escuro

se o backend ou OBS desconectarem, a interface mostrar erro/conexão perdida

o sistema tentar reconectar automaticamente

tudo funcionar de forma estável em rede local

Estratégia de implementação

Implementar em etapas:

Etapa 1

estrutura do backend e frontend

websocket interno funcionando

rota /tally/:deviceId

estado mockado para validar a interface

Etapa 2

integração real com OBS

leitura do mapeamento JSON

cálculo real de onAir

Etapa 3

integração do preview real por previewUrl

acabamento visual mobile

README final

Restrições

Não adicionar agora:

login

permissões complexas

dashboard administrativo completo

botões de controle do OBS

recursos que não sejam essenciais para o MVP

O foco deve permanecer exclusivamente em:

preview central

borda verde quando a source vinculada estiver no ar

uso simples em celular pelo navegador