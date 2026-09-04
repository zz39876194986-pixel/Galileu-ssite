// ============================================================
// GALILEU - lógica client-side (sem backend)
// Porta em JS do "cérebro" originalmente escrito em Python.
// Memória e histórico usam localStorage do navegador.
// ============================================================

// ---------- utilidades ----------

function normalizar(texto) {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function radical(palavra) {
  const p = normalizar(palavra);
  if (p.length > 4 && p.endsWith("oes")) return p.slice(0, -3) + "ao";
  if (p.length > 3 && p.endsWith("s") && !p.endsWith("ss")) return p.slice(0, -1);
  return p;
}

const PALAVRAS_IGNORADAS = new Set([
  "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "que", "oq", "e", "eh", "como", "por", "porque",
  "qual", "quais", "onde", "quando", "quem",
  "de", "do", "da", "dos", "das", "no", "na", "nos", "nas",
  "em", "para", "pra", "com", "se",
  "isso", "isto", "esse", "essa", "ele", "ela", "eles", "elas",
  "faz", "serve", "usado", "usada", "usados", "usadas",
  "funciona", "funcionam", "sobre", "me", "explica", "fala",
  "importante", "importantes", "finalidade",
  "seu", "seus", "sua", "suas", "funcao", "funcoes",
]);

function palavrasImportantes(texto) {
  const t = normalizar(texto);
  const encontradas = t.match(/[a-z0-9]+/g) || [];
  return encontradas.filter((p) => p.length >= 3 && !PALAVRAS_IGNORADAS.has(p));
}

// Similaridade simples (coeficiente de Sorensen-Dice sobre bigramas),
// usada só para pontuar a memória manual.
function similaridade(a, b) {
  const x = normalizar(a), y = normalizar(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bigramas = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const bx = bigramas(x), by = bigramas(y);
  let interseccao = 0;
  for (const [bg, n] of bx) {
    if (by.has(bg)) interseccao += Math.min(n, by.get(bg));
  }
  return (2 * interseccao) / ((x.length - 1) + (y.length - 1));
}

function classificarConfianca(pontos, alta, media, baixa) {
  if (pontos >= alta) return "alta";
  if (pontos >= media) return "media";
  if (pontos >= baixa) return "baixa";
  return null;
}

// ---------- persistência (localStorage) ----------

function carregarStorage(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch (e) {
    return padrao;
  }
}

function salvarStorage(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch (e) {
    // localStorage indisponível (modo privado, etc). Falha silenciosa.
  }
}

let memoria = carregarStorage("galileu_memoria", {});

// ---------- histórico com janela deslizante ----------
// Guarda as últimas MAX_HISTORICO trocas completas e um resumo (palavras-
// chave) das trocas mais antigas que já saíram da janela, pra não perder
// totalmente o fio da conversa quando ela fica longa.
const MAX_HISTORICO = 12;
const MAX_PALAVRAS_RESUMO = 40;

function migrarHistoricoSeNecessario(dados) {
  if (dados && typeof dados === "object" && Array.isArray(dados.trocas) && Array.isArray(dados.resumoAntigo)) {
    return dados;
  }
  // Formato antigo: array simples de {usuario, ia}.
  if (Array.isArray(dados)) return { trocas: dados, resumoAntigo: [] };
  return { trocas: [], resumoAntigo: [] };
}

let historicoDados = migrarHistoricoSeNecessario(carregarStorage("galileu_historico", { trocas: [], resumoAntigo: [] }));

function salvarMemoria() { salvarStorage("galileu_memoria", memoria); }
function salvarHistorico() { salvarStorage("galileu_historico", historicoDados); }

function resumirTroca(troca) {
  return palavrasImportantes(troca.usuario || "").concat(palavrasImportantes(troca.ia || ""));
}

function adicionarHistorico(usuario, ia) {
  historicoDados.trocas.push({ usuario, ia });
  while (historicoDados.trocas.length > MAX_HISTORICO) {
    const antiga = historicoDados.trocas.shift();
    historicoDados.resumoAntigo.push(...resumirTroca(antiga));
  }
  if (historicoDados.resumoAntigo.length > MAX_PALAVRAS_RESUMO) {
    historicoDados.resumoAntigo = historicoDados.resumoAntigo.slice(-MAX_PALAVRAS_RESUMO);
  }
  salvarHistorico();
}

function resumoConversaAntiga() {
  if (!historicoDados.resumoAntigo.length) return null;
  const vistas = [];
  for (const p of historicoDados.resumoAntigo) if (!vistas.includes(p)) vistas.push(p);
  return vistas.join(", ");
}

function limparHistorico() {
  historicoDados = { trocas: [], resumoAntigo: [] };
  salvarHistorico();
}

// ---------- estatísticas de uso ----------
const MAX_SEM_RESPOSTA = 20;
let estatisticas = carregarStorage("galileu_estatisticas", {
  totalPerguntas: 0,
  tempoTotalMs: 0,
  comandos: {},
  semResposta: [],
});

function salvarEstatisticas() { salvarStorage("galileu_estatisticas", estatisticas); }

function ehRespostaDeFalha(resposta) {
  return normalizar(resposta).startsWith("ainda nao sei responder isso");
}

function registrarEstatistica(pergunta, resposta, tempoMs, comando) {
  estatisticas.totalPerguntas++;
  estatisticas.tempoTotalMs += Math.max(0, tempoMs);
  if (comando) estatisticas.comandos[comando] = (estatisticas.comandos[comando] || 0) + 1;
  if (ehRespostaDeFalha(resposta)) {
    estatisticas.semResposta.push(pergunta);
    while (estatisticas.semResposta.length > MAX_SEM_RESPOSTA) estatisticas.semResposta.shift();
  }
  salvarEstatisticas();
}

function resumoEstatisticas() {
  if (estatisticas.totalPerguntas === 0) return "Ainda não registrei nenhuma pergunta nesta sessão.";
  const mediaSeg = (estatisticas.tempoTotalMs / estatisticas.totalPerguntas / 1000).toFixed(3);
  const linhas = [
    `Perguntas respondidas: ${estatisticas.totalPerguntas}`,
    `Tempo médio de resposta: ${mediaSeg}s`,
  ];
  const comandos = Object.entries(estatisticas.comandos);
  if (comandos.length) {
    const [nome, vezes] = comandos.sort((a, b) => b[1] - a[1])[0];
    linhas.push(`Comando mais usado: ${nome} (${vezes}x)`);
  }
  if (estatisticas.semResposta.length) {
    const ultimas = estatisticas.semResposta.slice(-5);
    linhas.push(`Perguntas sem resposta (últimas ${ultimas.length}):`);
    ultimas.forEach((p) => linhas.push(`  - ${p}`));
  }
  return linhas.join("\n");
}

function limparEstatisticas() {
  estatisticas = { totalPerguntas: 0, tempoTotalMs: 0, comandos: {}, semResposta: [] };
  salvarEstatisticas();
}

// ---------- cofre (backup criptografado via Web Crypto API) ----------
// Deriva a chave da senha com PBKDF2 (SHA-256) e cifra com AES-GCM. Nada
// disso passa pelo servidor: tudo roda local, no navegador.
const COFRE_STORAGE_KEY = "galileu_cofre";
const COFRE_ITERACOES = 200000;

function bufParaBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ParaBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

async function derivarChaveCofre(senha, salt) {
  const enc = new TextEncoder();
  const chaveBase = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: COFRE_ITERACOES, hash: "SHA-256" },
    chaveBase,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function cofreExportar(senha) {
  if (!senha || !senha.trim()) return "Informe uma senha. Ex: cofre exportar: minhasenha";
  if (typeof crypto === "undefined" || !crypto.subtle) return "Seu navegador não suporta criptografia local (Web Crypto API).";

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chave = await derivarChaveCofre(senha, salt);
  const enc = new TextEncoder();
  const conteudo = enc.encode(JSON.stringify(memoria));
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, conteudo);

  salvarStorage(COFRE_STORAGE_KEY, {
    salt: bufParaBase64(salt),
    iv: bufParaBase64(iv),
    dados: bufParaBase64(cifrado),
  });

  return "Backup criptografado salvo (neste navegador). Guarde a senha — ela não fica salva em nenhum lugar.";
}

async function cofreImportar(senha) {
  if (!senha || !senha.trim()) return "Informe a senha usada na exportação. Ex: cofre importar: minhasenha";
  if (typeof crypto === "undefined" || !crypto.subtle) return "Seu navegador não suporta criptografia local (Web Crypto API).";

  const pacote = carregarStorage(COFRE_STORAGE_KEY, null);
  if (!pacote) return "Não existe nenhum cofre salvo pra importar.";

  try {
    const salt = new Uint8Array(base64ParaBuf(pacote.salt));
    const iv = new Uint8Array(base64ParaBuf(pacote.iv));
    const cifrado = base64ParaBuf(pacote.dados);
    const chave = await derivarChaveCofre(senha, salt);
    const decifrado = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, chave, cifrado);
    const memoriaRestaurada = JSON.parse(new TextDecoder().decode(decifrado));

    memoria = memoriaRestaurada;
    salvarMemoria();
    return `Memória restaurada do cofre: ${Object.keys(memoria).length} itens.`;
  } catch (e) {
    return "Senha incorreta (ou cofre corrompido).";
  }
}

// ---------- base de conhecimento ----------

const CONHECIMENTO = {
  "eletricidade": {
    definicao: "Eletricidade envolve a presença e o movimento de cargas elétricas.",
    funcionamento: "A eletricidade funciona através do movimento ou da separação de cargas elétricas. Em um circuito, uma diferença de potencial provoca o movimento de elétrons pelos materiais condutores.",
    funcao: "A eletricidade permite transportar e utilizar energia para alimentar equipamentos, produzir luz, calor, movimento e sinais.",
    uso: "A eletricidade é usada em praticamente todos os equipamentos eletrônicos, iluminação, motores, computadores, eletrodomésticos e sistemas industriais.",
    importancia: "A eletricidade é importante porque permite alimentar tecnologias, comunicação, iluminação, máquinas, hospitais, transporte e grande parte da infraestrutura moderna.",
  },
  "capacitor": {
    definicao: "Um capacitor é um componente eletrônico que armazena energia em um campo elétrico.",
    funcionamento: "O capacitor armazena cargas elétricas e pode carregar e descarregar quando conectado a um circuito.",
    funcao: "Pode armazenar energia temporariamente, filtrar sinais e reduzir variações de tensão.",
    uso: "É usado em fontes de alimentação, filtros, motores, áudio e circuitos eletrônicos.",
    importancia: "Capacitores ajudam a estabilizar circuitos e controlar sinais elétricos.",
  },
  "resistor": {
    definicao: "Um resistor é um componente eletrônico que dificulta a passagem de corrente elétrica.",
    funcionamento: "O resistor limita a corrente e transforma parte da energia elétrica em calor.",
    funcao: "Sua principal função é limitar corrente e dividir tensão.",
    uso: "Resistores são usados em praticamente todos os tipos de circuitos eletrônicos.",
    importancia: "Eles ajudam a proteger componentes e controlar correntes e tensões.",
  },
  "diodo": {
    definicao: "Um diodo é um componente semicondutor que permite a passagem de corrente principalmente em uma direção.",
    funcionamento: "O diodo conduz corrente em uma condição de polarização e dificulta sua passagem na condição oposta.",
    funcao: "Pode controlar a direção da corrente, retificar corrente alternada e proteger circuitos.",
    uso: "É usado em fontes, retificadores e proteção contra polaridade.",
    importancia: "Permite controlar a direção da corrente elétrica.",
  },
  "transistor": {
    definicao: "Um transistor é um componente semicondutor usado principalmente para amplificar sinais ou funcionar como uma chave eletrônica.",
    funcionamento: "Pequenas variações em uma região do transistor podem controlar uma corrente maior em outra região.",
    funcao: "Controlar corrente elétrica, funcionando como chave ou amplificador.",
    uso: "É usado em processadores, amplificadores, fontes, computadores, celulares e praticamente toda a eletrônica moderna.",
    importancia: "Transistores são fundamentais para a eletrônica moderna.",
  },
  "gravidade": {
    definicao: "Gravidade é a interação responsável pela atração entre corpos que possuem massa.",
    funcionamento: "Corpos com massa exercem atração uns sobre os outros. Na relatividade geral, a gravidade é descrita como uma consequência da curvatura do espaço-tempo.",
    funcao: "A gravidade mantém planetas em órbita, faz objetos caírem e influencia estrelas e galáxias.",
    uso: "Seus efeitos são aproveitados, por exemplo, em geração hidrelétrica e estudos orbitais.",
    importancia: "A gravidade é fundamental para a formação e o funcionamento de sistemas planetários e estelares.",
  },
  "atomo": {
    definicao: "Um átomo é uma unidade fundamental da matéria formada por prótons, nêutrons e elétrons.",
    funcionamento: "Os elétrons ocupam regiões ao redor do núcleo, enquanto prótons e nêutrons ficam no núcleo.",
    funcao: "Os átomos formam os elementos químicos e participam da formação das moléculas e da matéria.",
    uso: "O conhecimento sobre átomos é usado em química, física, eletrônica, medicina e energia.",
    importancia: "Compreender os átomos ajuda a explicar a estrutura e o comportamento da matéria.",
  },
  "algoritmo": {
    definicao: "Algoritmo é uma sequência organizada de instruções usada para resolver um problema ou realizar uma tarefa.",
    funcionamento: "Um algoritmo recebe informações, segue etapas definidas e produz um resultado.",
    funcao: "Serve para organizar soluções de problemas e automatizar tarefas.",
    uso: "Algoritmos são usados em programas, aplicativos, jogos, sistemas de busca, inteligência artificial e automação.",
    importancia: "Eles são uma base fundamental da programação e da computação.",
  },
  "forca": {
    definicao: "Força é uma interação capaz de alterar o movimento de um corpo ou deformá-lo.",
    funcionamento: "Uma força pode acelerar, desacelerar, mudar a direção do movimento ou deformar um objeto.",
    funcao: "Forças produzem alterações no movimento e na forma dos corpos.",
    uso: "O conceito de força é usado para analisar movimentos, máquinas, estruturas e fenômenos físicos.",
    importancia: "Força é um conceito fundamental para compreender o movimento e as interações físicas.",
  },
  "energia": {
    definicao: "Energia é a capacidade de produzir transformações ou realizar trabalho.",
    funcionamento: "A energia pode ser transferida e transformada entre diferentes formas, como elétrica, térmica, química e mecânica.",
    funcao: "Permite que sistemas realizem trabalho e sofram transformações.",
    uso: "É usada em máquinas, veículos, aparelhos eletrônicos, indústria e processos naturais.",
    importancia: "A energia está envolvida em praticamente todas as transformações físicas e químicas.",
  },
  "massa": {
    definicao: "Massa é a quantidade de matéria que um corpo possui.",
    funcionamento: "A massa resiste a mudanças de movimento (inércia) e é também a fonte da atração gravitacional entre corpos.",
    funcao: "Determina o quanto um objeto resiste a acelerações e o quanto ele atrai outros corpos pela gravidade.",
    uso: "É usada em física, engenharia, medicina e no cálculo de forças e pesos.",
    importancia: "Massa é uma grandeza fundamental para descrever o comportamento de qualquer objeto físico.",
  },
  "velocidade": {
    definicao: "Velocidade é a taxa de variação da posição de um corpo em relação ao tempo.",
    funcionamento: "Calcula-se dividindo a distância percorrida pelo tempo gasto, considerando também a direção do movimento.",
    funcao: "Descreve o quão rápido e em que direção um corpo se move.",
    uso: "É usada em transportes, esportes, física e engenharia.",
    importancia: "Entender velocidade é essencial para prever e controlar o movimento de qualquer objeto.",
  },
  "luz": {
    definicao: "Luz é uma onda eletromagnética visível que também se comporta como partícula (fóton).",
    funcionamento: "A luz se propaga no vácuo a quase 300 mil km por segundo e pode ser refletida, refratada ou absorvida por materiais.",
    funcao: "Permite a visão e o transporte de energia e informação por meio de sinais ópticos.",
    uso: "É usada em iluminação, fibra óptica, fotografia, energia solar e comunicação.",
    importancia: "A luz é essencial para a visão, para a vida na Terra (fotossíntese) e para tecnologias modernas de comunicação.",
  },
  "som": {
    definicao: "Som é uma onda mecânica gerada por vibrações que se propaga por um meio material.",
    funcionamento: "As vibrações comprimem e descomprimem o meio (ar, água, sólidos), transportando energia até um receptor, como o ouvido.",
    funcao: "Permite a comunicação e a percepção do ambiente, e é usado em tecnologias como sonar e ultrassom.",
    uso: "É usado em música, comunicação, diagnósticos médicos (ultrassom) e navegação (sonar).",
    importancia: "Sem um meio material o som não se propaga, por isso não existe som no vácuo do espaço.",
  },
  "celula": {
    definicao: "Célula é a menor unidade estrutural e funcional dos seres vivos.",
    funcionamento: "Cada célula realiza processos como obtenção de energia e produção de proteínas, seguindo instruções contidas no DNA.",
    funcao: "Forma os tecidos e órgãos dos seres vivos e realiza as funções básicas da vida.",
    uso: "O estudo das células é usado em medicina, biotecnologia e pesquisa genética.",
    importancia: "Todo ser vivo é composto por uma ou mais células, tornando-as a base da biologia.",
  },
  "dna": {
    definicao: "DNA é a molécula que armazena as instruções genéticas de um ser vivo.",
    funcionamento: "É composto por uma sequência de bases que codificam informações usadas para construir proteínas e regular funções celulares.",
    funcao: "Serve como o 'manual de instruções' para o desenvolvimento e funcionamento de um organismo.",
    uso: "É usado em testes genéticos, medicina forense, biotecnologia e estudos evolutivos.",
    importancia: "O DNA é responsável pela hereditariedade e pela diversidade da vida.",
  },
  "evolucao": {
    definicao: "Evolução é o processo pelo qual as características de uma população mudam ao longo de gerações.",
    funcionamento: "Características que aumentam as chances de sobrevivência e reprodução tendem a se tornar mais comuns ao longo do tempo, principalmente por seleção natural.",
    funcao: "Explica a diversidade e a adaptação das espécies ao ambiente.",
    uso: "É usada em biologia, medicina (resistência a bactérias) e agricultura.",
    importancia: "A evolução é a base que explica a diversidade da vida na Terra.",
  },
  "fotossintese": {
    definicao: "Fotossíntese é o processo pelo qual plantas e outros organismos transformam luz solar em energia química.",
    funcionamento: "Usando luz, água e CO2, a planta produz glicose (energia) e libera oxigênio como subproduto.",
    funcao: "Fornece energia para a planta e libera o oxigênio que outros seres vivos respiram.",
    uso: "É a base da cadeia alimentar e da produção de oxigênio na atmosfera.",
    importancia: "Sem fotossíntese, praticamente toda a vida como conhecemos não existiria.",
  },
  "internet": {
    definicao: "Internet é uma rede global de computadores conectados que trocam informações.",
    funcionamento: "Os dados são divididos em pacotes que viajam por diferentes rotas até o destino, seguindo protocolos como o TCP/IP.",
    funcao: "Permite comunicação, transferência de dados e acesso a serviços remotos.",
    uso: "É usada para navegação web, e-mail, streaming, redes sociais e praticamente todo serviço digital.",
    importancia: "A internet é hoje uma infraestrutura essencial para comunicação, economia e acesso à informação.",
  },
  "inteligencia artificial": {
    definicao: "Inteligência artificial é a área da computação que cria sistemas capazes de simular comportamentos considerados inteligentes.",
    funcionamento: "Pode ser baseada em regras fixas (como este site) ou em aprendizado a partir de grandes quantidades de dados (como redes neurais).",
    funcao: "Automatiza tarefas como reconhecimento de padrões, geração de texto, tomada de decisão e previsão.",
    uso: "É usada em assistentes virtuais, recomendação de conteúdo, diagnósticos médicos e veículos autônomos.",
    importancia: "A IA está transformando praticamente todos os setores da tecnologia e da economia.",
  },
  "filosofia": {
    definicao: "Filosofia é o estudo racional de questões fundamentais sobre existência, conhecimento, valores e razão.",
    funcionamento: "Filósofos usam argumentação lógica e reflexão crítica para investigar perguntas que geralmente não têm resposta experimental direta.",
    funcao: "Ajuda a examinar pressupostos, clarear conceitos e formular perguntas fundamentais sobre o mundo e a vida.",
    uso: "É usada em ética aplicada, direito, ciência política e na própria base do método científico.",
    importancia: "A filosofia fornece ferramentas de pensamento crítico usadas em praticamente todas as áreas do conhecimento.",
  },
  "etica": {
    definicao: "Ética é o estudo do que é considerado certo ou errado e de como as pessoas deveriam agir.",
    funcionamento: "Diferentes teorias éticas avaliam ações por suas consequências, por regras/deveres ou pelo caráter de quem age, e frequentemente chegam a conclusões diferentes.",
    funcao: "Orienta decisões e comportamentos em situações que envolvem outras pessoas ou seres.",
    uso: "É aplicada em medicina, direito, negócios, tecnologia e na vida cotidiana.",
    importancia: "Questões éticas continuam sendo debatidas por pessoas racionais, sem um consenso único e definitivo.",
  },
  "universo": {
    definicao: "Universo é o conjunto de tudo o que existe: espaço, tempo, matéria e energia.",
    funcionamento: "Está em expansão desde o Big Bang, ocorrido há cerca de 13,8 bilhões de anos, e é regido pelas leis da física.",
    funcao: "Contém todas as galáxias, estrelas, planetas e demais estruturas conhecidas.",
    uso: "Seu estudo é feito pela astronomia e pela cosmologia.",
    importancia: "Entender o universo ajuda a responder perguntas fundamentais sobre nossa origem e lugar na existência.",
  },
  "buraco negro": {
    definicao: "Buraco negro é uma região do espaço com gravidade tão intensa que nada, nem mesmo a luz, consegue escapar dela.",
    funcionamento: "Forma-se quando uma estrela muito massiva colapsa sobre si mesma ao final de sua vida.",
    funcao: "Influencia fortemente o espaço ao seu redor, podendo atrair matéria e afetar órbitas de estrelas próximas.",
    uso: "Seu estudo ajuda a testar teorias da relatividade geral e a entender a evolução estelar.",
    importancia: "Buracos negros são fundamentais para entender gravidade extrema e o comportamento do espaço-tempo.",
  },
};

const RELACOES = {
  "eletricidade|resistor": "O resistor age sobre a eletricidade, limitando a corrente e controlando a tensão em um circuito.",
  "eletricidade|capacitor": "O capacitor armazena e libera energia elétrica, controlando variações de tensão em circuitos.",
  "diodo|eletricidade": "O diodo controla o sentido da corrente elétrica dentro de um circuito.",
  "eletricidade|transistor": "O transistor controla ou amplifica a corrente elétrica, sendo essencial em circuitos eletrônicos.",
  "capacitor|resistor": "Resistores e capacitores juntos formam circuitos RC, usados para controlar tensão e temporização.",
  "capacitor|diodo": "Capacitores e diodos se combinam em fontes de alimentação para retificar e filtrar sinais.",
  "diodo|transistor": "Transistores e diodos são semicondutores usados para controlar a passagem de corrente.",
  "energia|forca": "Força e energia se relacionam porque uma força aplicada sobre uma distância realiza trabalho, uma forma de energia.",
  "forca|gravidade": "A gravidade é uma força de atração entre corpos que possuem massa.",
  "eletricidade|energia": "A eletricidade é uma das formas que a energia pode assumir, permitindo seu transporte e uso.",
  "atomo|eletricidade": "A eletricidade está ligada ao movimento de elétrons, partículas que compõem o átomo.",
  "algoritmo|transistor": "Transistores formam os circuitos que executam fisicamente os algoritmos dentro de processadores.",
  "energia|gravidade": "A gravidade pode realizar trabalho, convertendo energia potencial em energia cinética.",
  "fotossintese|luz": "A fotossíntese depende diretamente da luz como fonte de energia para produzir glicose.",
  "celula|dna": "O DNA fica guardado dentro das células e contém as instruções que elas seguem para funcionar.",
  "buraco negro|universo": "Buracos negros são estruturas extremas que existem dentro do universo e ajudam a explicar fenômenos gravitacionais intensos.",
  "algoritmo|internet": "Algoritmos organizam como os dados trafegam, são buscados e recomendados dentro da internet.",
  "gravidade|massa": "Quanto mais massa um corpo tem, mais forte é a atração gravitacional que ele exerce.",
};

const INTENCOES = {
  definicao: ["o que e", "oq e", "o que eh", "oq eh", "o que significa", "oq significa", "define", "definicao", "me explica o que e", "me explica oq e"],
  funcionamento: ["como funciona", "como ele funciona", "como ela funciona", "como isso funciona", "como funciona isso", "qual o funcionamento", "qual e o funcionamento", "de que jeito funciona"],
  funcao: ["o que faz", "oq faz", "o que ele faz", "oq ele faz", "o que ela faz", "oq ela faz", "o que isso faz", "oq isso faz", "pra que serve", "para que serve", "pra que ele serve", "para que ele serve", "pra que ela serve", "para que ela serve", "qual a funcao", "qual e a funcao", "qual sua funcao", "qual a finalidade"],
  uso: ["onde e usado", "onde e usada", "onde sao usados", "onde sao usadas", "onde usa", "onde isso e usado", "onde ele e usado", "onde ela e usada", "em que e usado", "em que e usada", "no que e usado", "no que e usada", "no que ele e usado", "no que ela e usada", "em que areas e usado", "em que areas e usada", "quais sao os usos", "quais os usos", "pra que e usado", "pra que e usada", "para que e usado", "para que e usada", "aonde e usado", "aonde e usada"],
  importancia: ["por que e importante", "porque e importante", "por que isso e importante", "porque isso e importante", "por que ele e importante", "porque ele e importante", "por que ela e importante", "porque ela e importante", "qual a importancia", "qual e a importancia", "por que isso importa"],
};

const PRINCIPIOS = [
  "Prefiro admitir que não sei a inventar uma resposta.",
  "Quando a confiança na resposta é baixa, eu aviso (🤔).",
  "Aprendo com o que você me ensina, mas não finjo aprender o que não entendi.",
  "Tento achar o assunto certo pelo contexto antes de desistir e usar respostas genéricas.",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectarAssuntosMultiplos(pergunta) {
  const t = normalizar(pergunta);
  const assuntos = Object.keys(CONHECIMENTO).sort((a, b) => b.length - a.length);
  const encontrados = [];
  for (const assunto of assuntos) {
    if (t.includes(assunto) && !encontrados.includes(assunto)) encontrados.push(assunto);
  }
  return encontrados;
}

function ehPerguntaDeRelacao(pergunta) {
  const t = normalizar(pergunta);
  const padroes = ["relacao entre", "relacao com", "qual a relacao", "qual e a relacao", "diferenca entre", "qual a diferenca", "tem a ver com", "tem relacao com"];
  return padroes.some((p) => t.includes(p));
}

function buscarRelacao(pergunta, ultimosAssuntos) {
  if (!ehPerguntaDeRelacao(pergunta)) return null;
  ultimosAssuntos = ultimosAssuntos || [];
  let assuntos = detectarAssuntosMultiplos(pergunta);

  if (assuntos.length < 2) {
    if (assuntos.length === 1) {
      const candidatos = ultimosAssuntos.filter((a) => a !== assuntos[0]);
      if (candidatos.length) assuntos = [assuntos[0], candidatos[0]];
      else return null;
    } else if (assuntos.length === 0 && ultimosAssuntos.length >= 2) {
      assuntos = ultimosAssuntos.slice(0, 2);
    } else {
      return null;
    }
  }

  const [a, b] = assuntos;
  const chave1 = `${a}|${b}`, chave2 = `${b}|${a}`;
  if (RELACOES[chave1]) return RELACOES[chave1];
  if (RELACOES[chave2]) return RELACOES[chave2];

  const defA = (CONHECIMENTO[a] || {}).definicao;
  const defB = (CONHECIMENTO[b] || {}).definicao;
  if (!defA || !defB) return null;

  return `Não tenho uma relação direta cadastrada entre ${a} e ${b}, mas veja as definições:\n- ${capitalizar(a)}: ${defA}\n- ${capitalizar(b)}: ${defB}`;
}

function capitalizar(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function detectarIntencao(pergunta) {
  const t = normalizar(pergunta);
  let melhor = null, melhorTamanho = 0;

  for (const [intencao, frases] of Object.entries(INTENCOES)) {
    for (const frase of frases) {
      const padrao = new RegExp("(?<![\\w])" + escapeRegex(frase) + "(?![\\w])");
      if (padrao.test(t) && frase.length > melhorTamanho) {
        melhorTamanho = frase.length;
        melhor = intencao;
      }
    }
  }
  if (melhor) return melhor;

  if (/(?<!\w)important\w*/.test(t)) return "importancia";
  if (/(?<!\w)funciona\w*/.test(t)) return "funcionamento";
  if (/(?<!\w)(serve|finalidade|funcao)/.test(t)) return "funcao";
  if (/(?<!\w)usad\w*/.test(t)) return "uso";
  return null;
}

function detectarAssunto(pergunta) {
  const t = normalizar(pergunta);
  const assuntos = Object.keys(CONHECIMENTO).sort((a, b) => b.length - a.length);

  for (const assunto of assuntos) {
    if (t.includes(assunto) || t.includes(assunto + "s")) return assunto;
  }

  const palavras = new Set(palavrasImportantes(t).map(radical));
  let melhor = null, maior = 0;
  for (const assunto of assuntos) {
    const palavrasAssunto = new Set(normalizar(assunto).split(" ").map(radical));
    let pontos = 0;
    for (const p of palavras) if (palavrasAssunto.has(p)) pontos++;
    if (pontos > maior) { maior = pontos; melhor = assunto; }
  }
  return maior > 0 ? melhor : null;
}

function buscarConhecimento(pergunta) {
  const assunto = detectarAssunto(pergunta);
  if (!assunto) return null;
  const intencao = detectarIntencao(pergunta) || "definicao";
  return CONHECIMENTO[assunto][intencao] || null;
}

// ---------- memória manual ----------

function aprender(texto) {
  if (!normalizar(texto).startsWith("aprenda:")) return null;
  if (!texto.includes("=")) return "Use assim:\naprenda: pergunta = resposta";

  const conteudo = texto.split(":").slice(1).join(":");
  const partes = conteudo.split("=");
  const pergunta = normalizar(partes[0]);
  const resposta = partes.slice(1).join("=").trim();

  if (!pergunta) return "A pergunta está vazia.";
  if (!resposta) return "A resposta está vazia.";

  memoria[pergunta] = resposta;
  salvarMemoria();
  return "Aprendi e salvei na memória (neste navegador).";
}

function buscarMemoria(pergunta) {
  const palavras = new Set(palavrasImportantes(pergunta).map(radical));
  if (palavras.size === 0) return null;

  let melhor = null, maior = 0;

  for (const [chave, resposta] of Object.entries(memoria)) {
    const chaveNorm = normalizar(chave);
    const respostaNorm = normalizar(resposta);
    const chavePalavras = new Set((chaveNorm.match(/[a-z0-9]+/g) || []).map(radical));
    const respostaPalavras = new Set((respostaNorm.match(/[a-z0-9]+/g) || []).map(radical));

    const encChave = [...palavras].filter((p) => chavePalavras.has(p));
    const encResposta = [...palavras].filter((p) => respostaPalavras.has(p));
    if (!encChave.length && !encResposta.length) continue;

    let pontos = encChave.length * 25 + encResposta.length * 3;
    pontos += (encChave.length / Math.max(1, palavras.size)) * 35;
    pontos += similaridade(pergunta, chave) * 8;

    if (pontos > maior) { maior = pontos; melhor = resposta; }
  }

  if (melhor !== null && maior >= 20) {
    return [melhor, classificarConfianca(maior, 60, 35, 20)];
  }
  return null;
}

function anexarConfianca(texto, confianca) {
  if (confianca === "alta") return texto;
  if (confianca === "media") return `${texto}\n🤔 acho que é isso`;
  return `${texto}\n🤔 não tenho certeza absoluta`;
}

// ---------- calculadora ----------

function calcular(expressao) {
  if (!/^[0-9\s+\-*/%().]+$/.test(expressao)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const resultado = Function(`"use strict"; return (${expressao});`)();
    return typeof resultado === "number" && isFinite(resultado) ? resultado : null;
  } catch (e) {
    return null;
  }
}

function tentarCalcular(texto) {
  let t = normalizar(texto);
  t = t.replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "**");
  t = t.replace(/\bvezes\b/g, "*");
  t = t.replace(/\bdividido por\b/g, "/");
  t = t.replace(/\bmais\b/g, "+");
  t = t.replace(/\bmenos\b/g, "-");

  const porcentagem = t.match(/^(\d+(?:\.\d+)?)\s*%\s*(?:de|do|da)\s*(\d+(?:\.\d+)?)$/);
  if (porcentagem) return (parseFloat(porcentagem[1]) / 100) * parseFloat(porcentagem[2]);

  t = t.replace(/\bquanto\s+(e|eh|da)\b/g, "");
  t = t.replace(/\b(calcula|calcule|resolve)\b/g, "");
  t = t.replace(/(?<=\d)\s*x\s*(?=\d)/g, "*");
  // Remove pontuação de fim de frase (ex: "quanto é 5x7?") antes de validar.
  t = t.trim().replace(/[?!.,;:]+$/, "").trim();

  if (!/^[0-9\s+\-*/%().]+$/.test(t)) return null;
  if (!/[+\-*/%]/.test(t)) return null;

  return calcular(t);
}

// ---------- comandos e conversa genérica ----------

function ehSaudacao(texto) {
  const t = normalizar(texto);
  return ["oi", "ola", "eae", "eai", "e ai", "opa", "salve", "fala", "iae", "coe"].includes(t);
}

const LISTA_COMANDOS =
  "Meus comandos são:\n" +
  "memoria — mostra o que aprendi manualmente\n" +
  "historico — mostra as últimas conversas\n" +
  "limpar memoria — apaga a memória manual\n" +
  "limpar historico — apaga o histórico\n" +
  "resumo historico — palavras-chave de conversas antigas fora da janela\n" +
  "estatisticas — mostra quantas perguntas respondi e afins\n" +
  "limpar estatisticas — zera as estatísticas de uso\n" +
  "cofre exportar: senha — salva um backup criptografado da memória\n" +
  "cofre importar: senha — restaura a memória a partir do backup\n" +
  "seus principios — mostra como eu tento pensar\n" +
  "aprenda: pergunta = resposta — me ensina algo novo";

function ehPerguntaSobreComandos(texto) {
  const t = normalizar(texto);
  const padroes = ["quais comandos", "que comandos", "quais sao os comandos", "quais os comandos", "lista de comandos", "seus comandos", "quais comandos voce tem", "o que voce sabe fazer", "o que voce faz", "quais suas funcoes", "quais funcoes voce tem", "me mostra os comandos", "me fala os comandos", "ajuda", "socorro", "help"];
  return padroes.some((p) => t.includes(p));
}

function responderIntencaoGenerica(texto) {
  const t = normalizar(texto);
  if (ehSaudacao(texto)) return ["Eae.", "Salve.", "Fala aí.", "Opa."][Math.floor(Math.random() * 4)];
  if (["tchau", "falou", "flw", "ate mais"].includes(t)) return "Falou.";
  if (t.includes("que horas") || t.includes("horas sao") || t.includes("qual a hora") || t.includes("data de hoje") || t.includes("que dia e hoje")) {
    return new Date().toLocaleString("pt-BR");
  }
  return null;
}

// ---------- estado da sessão (não persiste entre recarregamentos) ----------

let assuntoAtual = null;
let sessaoAssuntos = [];

function ultimosAssuntosDistintos(n) {
  const encontrados = [];
  for (let i = sessaoAssuntos.length - 1; i >= 0; i--) {
    const a = sessaoAssuntos[i];
    if (!encontrados.includes(a)) encontrados.push(a);
    if (encontrados.length >= n) break;
  }
  return encontrados;
}

function contextoRelevante(pergunta) {
  const t = normalizar(pergunta);
  const referencias = ["ele", "ela", "eles", "elas", "isso", "isto", "esse", "essa", "dele", "dela", "desse", "dessa"];
  if (referencias.some((ref) => new RegExp("(?<!\\w)" + ref + "(?!\\w)").test(t))) return true;
  if (detectarIntencao(pergunta) && palavrasImportantes(pergunta).length === 0) return true;
  return false;
}

function pegarUltimoAssunto() {
  if (assuntoAtual) return assuntoAtual;
  if (sessaoAssuntos.length) { assuntoAtual = sessaoAssuntos[sessaoAssuntos.length - 1]; return assuntoAtual; }
  return null;
}

function buscarContexto(pergunta) {
  if (!contextoRelevante(pergunta)) return null;
  const assunto = pegarUltimoAssunto();
  if (!assunto) return null;
  const intencao = detectarIntencao(pergunta);
  if (!intencao) return null;
  const dados = CONHECIMENTO[assunto];
  return dados ? (dados[intencao] || null) : null;
}

// ============================================================
// FUNÇÃO PRINCIPAL: pensar()
// ============================================================

function pensar(entrada) {
  const original = entrada;

  // 1. Matemática
  const resultadoCalc = tentarCalcular(original);
  if (resultadoCalc !== null) {
    const arred = Number.isInteger(resultadoCalc) ? resultadoCalc : Math.round(resultadoCalc * 1e6) / 1e6;
    return `Resultado: ${arred}`;
  }

  // 2. Aprendizado
  const aprendizado = aprender(original);
  if (aprendizado) return aprendizado;

  const t = normalizar(original);

  // 3. Comandos do sistema
  if (t === "memoria") {
    const chaves = Object.keys(memoria);
    if (!chaves.length) return "Minha memória está vazia (neste navegador).";
    return chaves.map((k) => `${k} = ${memoria[k]}`).join("\n");
  }

  if (t === "limpar memoria") {
    memoria = {};
    salvarMemoria();
    return "Memória apagada.";
  }

  if (t === "historico") {
    if (!historicoDados.trocas.length) return "O histórico está vazio.";
    return historicoDados.trocas.map((h) => `Usuário: ${h.usuario}\nGalileu: ${h.ia}`).join("\n");
  }

  if (t === "limpar historico") {
    limparHistorico();
    return "Histórico apagado.";
  }

  if (t === "resumo historico" || t === "resumo do historico") {
    const resumo = resumoConversaAntiga();
    return resumo || "Ainda não tenho conversas antigas fora da janela recente.";
  }

  if (t === "estatisticas") return resumoEstatisticas();

  if (t === "limpar estatisticas") {
    limparEstatisticas();
    return "Estatísticas zeradas.";
  }

  if (t.startsWith("cofre exportar")) {
    const senha = original.includes(":") ? original.split(":").slice(1).join(":").trim() : "";
    return cofreExportar(senha);
  }

  if (t.startsWith("cofre importar")) {
    const senha = original.includes(":") ? original.split(":").slice(1).join(":").trim() : "";
    return cofreImportar(senha);
  }

  if (t.includes("principios") || t.includes("principio")) {
    return "Isso guia minhas respostas:\n" + PRINCIPIOS.map((p) => `- ${p}`).join("\n");
  }

  if (ehPerguntaSobreComandos(original)) return LISTA_COMANDOS;

  if (t.includes("seu nome") || t.includes("como voce se chama") || t.includes("qual seu nome")) {
    return "Sou o Galileu.";
  }

  if (t.includes("quem e voce") || t.includes("o que voce e") || t.includes("quem e vc")) {
    return "Sou o Galileu, uma IA local feita em JavaScript, rodando direto no seu navegador.";
  }

  // 4. Detectar assunto (mantém contexto da conversa)
  const assunto = detectarAssunto(original);
  if (assunto) {
    assuntoAtual = assunto;
    if (!sessaoAssuntos.length || sessaoAssuntos[sessaoAssuntos.length - 1] !== assunto) {
      sessaoAssuntos.push(assunto);
    }
  } else if (palavrasImportantes(original).length && !contextoRelevante(original)) {
    assuntoAtual = null;
  }

  // 4.5 Relação/diferença entre conceitos
  const relacao = buscarRelacao(original, ultimosAssuntosDistintos(2));
  if (relacao) return relacao;

  // 5. Contexto (pronomes)
  const contexto = buscarContexto(original);
  if (contexto) return contexto;

  // 6. Conhecimento estruturado
  const conhecimento = buscarConhecimento(original);
  if (conhecimento) return conhecimento;

  const bloquear = contextoRelevante(original) && !(pegarUltimoAssunto() in CONHECIMENTO);

  // 7. Memória manual
  if (!bloquear) {
    const memResultado = buscarMemoria(original);
    if (memResultado) {
      const [texto, confianca] = memResultado;
      if (confianca !== "baixa") return anexarConfianca(texto, confianca);
    }
  }

  // 8. Conversa genérica
  const generica = responderIntencaoGenerica(original);
  if (generica) return generica;

  return "Ainda não sei responder isso.\nVocê pode me ensinar com:\naprenda: pergunta = resposta";
}
