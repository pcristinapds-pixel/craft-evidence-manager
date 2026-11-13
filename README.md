# Craft QA - Evidenciador de Testes Desktop

## Primeira vez
1. `npm install`
2. `npm start` para abrir o app
3. `npm run build:win` para gerar o instalador em `dist/`

## Testes unitários
`npm test` roda os testes da pasta `tests/` (Node, sem dependências extras):
- **mascarar**: tokens, senhas, chaves de API e CPF viram variáveis no cURL
- **bdd**: estrutura mínima Dado / Quando / Então (ou Given / When / Then)
- **evidence-store**: execuções novas e substituídas, ordem dos CTs, back-end
- **report-builder**: relatório, histórico separado, relatório de bug, limites de vídeo (50 MB / 100 MB), segurança do HTML
- **video-tools**: padronizar, compactar e editar vídeo (usa o FFmpeg; pulados se ele não estiver instalado)

## Testar só o PPT
`npm run test:ppt` gera um PPT de exemplo na pasta `exemplo-saida/` (com print ultrawide, print 16:9 e vídeo).

## Atalhos durante a evidência
- **F9**: tirar print
- **Ctrl+Shift+R**: iniciar/parar gravação de vídeo
- **Ctrl+Shift+F**: finalizar e revisar

Na revisão: clique e arraste sobre o print para destacar, use ▲ ▼ para mudar a ordem, ✕ para excluir.

## Versão portátil (sem instalar)
1. `npm run build:portable`
2. O arquivo `dist/Craft Evidencias 1.0.0.exe` é o app completo, sem instalação.
3. Copie esse .exe para uma pasta de rede compartilhada (ou para cada máquina).
4. Para criar o atalho: clique com o botão direito no .exe → **Mostrar mais opções** → **Enviar para** → **Área de trabalho (criar atalho)**.
   Também dá para fixar na barra de tarefas: abra o app, clique com o botão direito no ícone da barra → **Fixar na barra de tarefas**.

Na primeira vez o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**.
As configurações (pasta dos PPTs, atalhos) ficam salvas por usuário, então cada QA pode ter as suas.

## Gravação e edição de vídeo
- Durante a gravação: **Pausar / Retomar** na barra flutuante (atalho **Ctrl+Shift+P**). O trecho pausado não entra no vídeo.
- Na revisão, ao abrir um vídeo:
  - arraste as alças da linha do tempo (ou use **Começar aqui / Terminar aqui**) para recortar início e fim;
  - **Excluir trecho**: clique uma vez no início e outra no fim do trecho que deve sair;
  - **Dividir aqui**: separa o vídeo em partes; cada parte vira um slide;
  - **▶** mostra a prévia já com as edições; **Aplicar edição** gera o vídeo final com corte exato;
  - **Desfazer edição** volta ao vídeo original.
- A edição usa o FFmpeg (pacote `ffmpeg-static`), instalado com `npm install`.
