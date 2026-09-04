# Galileu — versão site

Versão do Galileu que roda 100% no navegador (sem precisar de Python nem
de servidor). Ideal pra hospedar de graça no GitHub Pages.

A "memória" e o "histórico" ficam salvos no `localStorage` do navegador
de quem estiver usando — cada pessoa que acessar o site tem a própria
memória, guardada só no aparelho dela.

## Como publicar no GitHub Pages (pelo celular, sem git)

1. Cria uma conta no [github.com](https://github.com) se ainda não tiver.
2. Cria um repositório novo, público, com o nome que quiser (ex: `galileu`).
3. Dentro do repositório vazio, clica em **"uploading an existing file"**
   (ou "Add file" → "Upload files").
4. Arrasta ou seleciona **todos** os arquivos desta pasta:
   `index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`,
   `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`.
5. Clica em "Commit changes" (ou "Confirmar alterações").
6. Vai em **Settings → Pages** (barra lateral do repositório).
7. Em "Branch", seleciona `main` e a pasta `/ (root)`, depois **Save**.
8. Espera 1-2 minutos. O GitHub mostra o link do site, algo como:
   `https://seu-usuario.github.io/galileu/`

Pronto — esse link funciona em qualquer celular ou computador, sem
precisar do Termux aberto. Dá pra "Adicionar à tela inicial" no Chrome
que ele funciona como app (inclusive funciona offline depois da
primeira visita, graças ao service worker).

## Como publicar via linha de comando (Termux, com git)

```bash
cd ~/galileu-site
git init
git add .
git commit -m "Primeira versão do site do Galileu"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/galileu.git
git push -u origin main
```

Depois é só ativar o GitHub Pages nas Settings do repositório, igual
descrito acima (passos 6-8).

## Diferenças em relação à versão Python (Termux)

Essa versão web é mais enxuta de propósito — ela não inclui:
- Absorção de livros/textos longos (`absorver livro:`)
- Correção automática de erros de digitação
- Fallback pra um modelo de linguagem local (llama.cpp)

Ela mantém: base de conhecimento (23 assuntos), relações entre
conceitos, contexto de conversa, calculadora, aprendizado manual
(`aprenda: pergunta = resposta`) e todos os comandos do sistema.
