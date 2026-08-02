// ============================================================
// pdf-to-quiz.js
// Extrai questões de PDFs de provas (formato A/B/C/D/E) e gera
// um JSON pronto para alimentar um simulado.
// ============================================================

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let rawPdfTextContent = "";
let questionsData = [];
let currentQuestionIndex = 0;
let userAnswers = {};

// ------------------------------------------------------------
// 1) EXTRAÇÃO DE TEXTO DO PDF (com ordenação por posição)
// ------------------------------------------------------------
// Em vez de simplesmente concatenar textContent.items na ordem
// que vêm do content stream (que pode intercalar colunas em
// PDFs de 2 colunas), agrupamos por linha (mesma coordenada Y)
// e ordenamos da esquerda pra direita dentro de cada linha.
// Isso reduz — mas não elimina 100% — o risco de mistura de
// colunas. Para provas de 2 colunas "difíceis", considere
// pré-processar o PDF (ex: dividir em 2 PDFs de coluna única).
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    const items = textContent.items
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter(it => it.str.trim() !== '');

    if (items.length === 0) { fullText += "\n\n"; continue; }

    // Agrupa por linha (tolerância de Y para lidar com pequenas
    // variações de baseline dentro da mesma linha visual)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const LINE_TOLERANCE = 2.5;
    const lines = [];
    let currentLine = [];
    let lastY = null;

    for (const it of items) {
      if (lastY === null || Math.abs(it.y - lastY) <= LINE_TOLERANCE) {
        currentLine.push(it);
      } else {
        lines.push(currentLine);
        currentLine = [it];
      }
      lastY = it.y;
    }
    if (currentLine.length) lines.push(currentLine);

    const pageText = lines
      .map(line => line.sort((a, b) => a.x - b.x).map(it => it.str).join(' '))
      .join('\n');

    fullText += pageText + "\n\n";
  }

  return fullText;
}

// ------------------------------------------------------------
// 2) LIMPEZA DE TEXTO
// ------------------------------------------------------------
function cleanGarbage(text) {
  if (!text) return '';
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------
// 3) EXTRAÇÃO DE ALTERNATIVAS A-E (BUG CORRIGIDO AQUI)
// ------------------------------------------------------------
function extractOptionsFromSlice(slice) {
  const optRegex = /(?:^|\n|\s+)(?:\(([A-E])\)|([A-E])[\.\)\-])\s+/g;
  const matches = [];
  let m;

  while ((m = optRegex.exec(slice)) !== null) {
    const letter = (m[1] || m[2]).toUpperCase();
    matches.push({ letter, index: m.index, matchLength: m[0].length });
  }

  let matchA = null, matchB = null, matchC = null, matchD = null, matchE = null;

  for (const item of matches) {
    if (item.letter === 'A' && !matchA) {
      matchA = item;
    } else if (item.letter === 'B' && matchA && !matchB && item.index > matchA.index) {
      matchB = item;
    } else if (item.letter === 'C' && matchB && !matchC && item.index > matchB.index) {
      matchC = item;
    } else if (item.letter === 'D' && matchC && !matchD && item.index > matchC.index) {
      // ANTES: comparava com matchD.index (que era null) -> TypeError
      matchD = item;
    } else if (item.letter === 'E' && matchD && !matchE && item.index > matchD.index) {
      matchE = item;
    }
  }

  if (matchA && matchB && matchC && matchD && matchE) {
    if ((matchE.index - matchA.index) > 2500) return { valid: false };

    const statement = slice.substring(0, matchA.index).trim();

    // Enunciado mínimo plausível — evita "questões fantasma"
    if (statement.length < 10) return { valid: false };

    const optA = slice.substring(matchA.index + matchA.matchLength, matchB.index).trim();
    const optB = slice.substring(matchB.index + matchB.matchLength, matchC.index).trim();
    const optC = slice.substring(matchC.index + matchC.matchLength, matchD.index).trim();
    const optD = slice.substring(matchD.index + matchD.matchLength, matchE.index).trim();

    const restE = slice.substring(matchE.index + matchE.matchLength);
    let endEOffset = restE.search(/(?:\n\s*\n|\n?\s*(?:QUESTÃO|\d{1,2}\s*[\.\)\-])|\n?\s*CONHECIMENTOS)/i);
    if (endEOffset === -1 || endEOffset > 300) endEOffset = Math.min(restE.length, 250);
    const optE = restE.substring(0, endEOffset).trim();

    const options = {
      A: cleanGarbage(optA),
      B: cleanGarbage(optB),
      C: cleanGarbage(optC),
      D: cleanGarbage(optD),
      E: cleanGarbage(optE)
    };

    // Todas as alternativas precisam ter conteúdo real
    if (Object.values(options).some(v => v.length < 1)) return { valid: false };

    return { valid: true, statement, options };
  }

  return { valid: false };
}

// ------------------------------------------------------------
// 4) PARSER PRINCIPAL — identifica os cabeçalhos de questão
// ------------------------------------------------------------
// Filtra números soltos de instruções/tabelas exigindo que o
// "cabeçalho" da questão esteja isolado (precedido por quebra
// de parágrafo) e que exista pelo menos um bloco A-E válido
// logo em seguida.
function parseExamQuestions(rawText) {
  const cleanText = cleanGarbage(rawText);

  // Corta tudo antes do início real das questões, se existir
  // um marcador de seção (evita casar "01 -", "02 -" das
  // instruções da capa da prova).
  const sectionMarkers = /(CONHECIMENTOS\s+B[ÁA]SICOS|CONHECIMENTOS\s+ESPEC[ÍI]FICOS|LÍNGUA\s+PORTUGUESA)/i;
  const sectionMatch = cleanText.search(sectionMarkers);
  const searchText = sectionMatch !== -1 ? cleanText.slice(sectionMatch) : cleanText;

  const qHeaderRegex = /(?:^|\n)\s*(?:QUESTÃO\s+)?(\d{1,3})\s*[\.\)\-]\s+/gi;
  let match;
  const candidates = [];

  while ((match = qHeaderRegex.exec(searchText)) !== null) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 200) {
      candidates.push({ number: num, index: match.index, contentIndex: match.index + match[0].length });
    }
  }

  const extracted = [];
  let activeSupportText = '';

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const nextIndex = candidates[i + 1] ? candidates[i + 1].index : cand.contentIndex + 2500;
    const searchSlice = searchText.substring(cand.contentIndex, Math.min(cand.contentIndex + 2500, nextIndex));
    const parsed = extractOptionsFromSlice(searchSlice);

    if (parsed.valid) {
      let statement = parsed.statement;
      const textHeaderMatch = statement.match(/(?:\bTEXTO\s+[I|V|X\d]*|\bREAD\s+THE\s+TEXT|\bLEIA\s+O\s+TEXTO)/i);
      if (textHeaderMatch) {
        activeSupportText = statement.substring(textHeaderMatch.index).trim();
        statement = statement.substring(0, textHeaderMatch.index).trim();
      }

      extracted.push({
        number: cand.number,
        text: statement || `Questão ${cand.number}`,
        supportText: activeSupportText,
        options: parsed.options
      });
    }
  }

  // Deduplica por número, mantendo a primeira ocorrência válida
  const uniqueQuestions = [];
  const seenNumbers = new Set();
  for (const q of extracted) {
    if (!seenNumbers.has(q.number)) {
      seenNumbers.add(q.number);
      uniqueQuestions.push(q);
    }
  }

  return uniqueQuestions.sort((a, b) => a.number - b.number);
}

// ------------------------------------------------------------
// 5) (OPCIONAL) EXTRAÇÃO DO GABARITO DE UM SEGUNDO PDF
// ------------------------------------------------------------
// Aceita padrões comuns tipo "1 - E" ou "1-E" ou "01. E"
function parseAnswerKey(rawText) {
  const cleanText = cleanGarbage(rawText);
  const keyRegex = /(\d{1,3})\s*[\.\)\-]\s*([A-E])\b/g;
  const answerKey = {};
  let m;
  while ((m = keyRegex.exec(cleanText)) !== null) {
    const num = parseInt(m[1], 10);
    if (num >= 1 && num <= 200 && !(num in answerKey)) {
      answerKey[num] = m[2].toUpperCase();
    }
  }
  return answerKey;
}

// ------------------------------------------------------------
// 6) EXPORTAÇÃO PARA O SCHEMA JSON DO SIMULADO
// ------------------------------------------------------------
function buildQuizJSON(questions, answerKey = {}) {
  return questions.map(q => ({
    id: q.number,
    materia: null, // opcional: preencher manualmente ou por faixa de número
    enunciado: q.supportText ? `${q.supportText}\n\n${q.text}` : q.text,
    alternativas: {
      a: q.options.A,
      b: q.options.B,
      c: q.options.C,
      d: q.options.D,
      e: q.options.E
    },
    resposta_correta: answerKey[q.number] ? answerKey[q.number].toLowerCase() : null
  }));
}

function downloadJSON(data, filename = 'questoes.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// 7) UI — inputs de arquivo e drag & drop (prova)
// ------------------------------------------------------------
const pdfProvaInput = document.getElementById('pdfProvaInput');
const dropZoneProva = document.getElementById('dropZoneProva');
const statusProva = document.getElementById('statusProva');

async function handleFileSelect(file) {
  if (file && file.type === 'application/pdf') {
    statusProva.innerText = `⏳ Lendo arquivo: ${file.name}...`;
    try {
      rawPdfTextContent = await extractTextFromPDF(file);
      statusProva.innerText = `✅ Prova carregada com sucesso! (${file.name})`;
    } catch (err) {
      console.error(err);
      statusProva.innerText = `❌ Erro ao ler o PDF. Certifique-se de que é um PDF com texto selecionável.`;
    }
  }
}

pdfProvaInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
});

dropZoneProva.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZoneProva.classList.add('dragover');
});

dropZoneProva.addEventListener('dragleave', () => dropZoneProva.classList.remove('dragover'));

dropZoneProva.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZoneProva.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
});

// ------------------------------------------------------------
// 8) RENDERIZAÇÃO DAS QUESTÕES
// ------------------------------------------------------------
function renderQuestion(index) {
  if (!questionsData || !questionsData[index]) return;

  const q = questionsData[index];
  document.getElementById('questionCounter').innerText = `Questão ${q.number}`;
  document.getElementById('totalCounter').innerText = `${index + 1} de ${questionsData.length}`;
  document.getElementById('questionText').innerText = q.text;

  const supportContainer = document.getElementById('supportContainer');
  const supportText = document.getElementById('supportText');

  if (q.supportText && q.supportText.trim() !== '') {
    supportText.innerText = q.supportText;
    supportContainer.style.display = 'block';
  } else {
    supportContainer.style.display = 'none';
  }

  const optionsList = document.getElementById('optionsList');
  optionsList.innerHTML = '';

  ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
    if (q.options && q.options[letter]) {
      const isSelected = userAnswers[q.number] === letter;
      const optDiv = document.createElement('div');
      optDiv.className = `option-item ${isSelected ? 'selected' : ''}`;
      optDiv.onclick = () => {
        userAnswers[q.number] = letter;
        renderQuestion(currentQuestionIndex);
      };

      optDiv.innerHTML = `
        <span class="option-letter">${letter})</span>
        <span class="option-text">${q.options[letter]}</span>
      `;
      optionsList.appendChild(optDiv);
    }
  });

  document.getElementById('prevBtn').disabled = (index === 0);
  document.getElementById('nextBtn').innerText = (index === questionsData.length - 1) ? 'Finalizar' : 'Próxima →';
}

// ------------------------------------------------------------
// 9) EVENTOS DE CONTROLE
// ------------------------------------------------------------
document.getElementById('startBtn').addEventListener('click', () => {
  if (!rawPdfTextContent) {
    alert("Por favor, selecione ou arraste o PDF da prova antes de iniciar.");
    return;
  }

  questionsData = parseExamQuestions(rawPdfTextContent);

  if (questionsData.length === 0) {
    alert("Nenhuma questão foi detectada. Verifique se o arquivo PDF contém texto selecionável (não pode ser apenas uma imagem digitalizada).");
    return;
  }

  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('quizScreen').classList.remove('hidden');

  currentQuestionIndex = 0;
  userAnswers = {};
  renderQuestion(0);
});

document.getElementById('prevBtn').addEventListener('click', () => {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex--;
    renderQuestion(currentQuestionIndex);
  }
});

document.getElementById('nextBtn').addEventListener('click', () => {
  if (currentQuestionIndex < questionsData.length - 1) {
    currentQuestionIndex++;
    renderQuestion(currentQuestionIndex);
  } else {
    alert('Simulado finalizado!');
  }
});

// Exemplo de uso do botão de exportar JSON (adicione um botão
// com id="exportJsonBtn" no seu HTML para habilitar):
const exportBtn = document.getElementById('exportJsonBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const json = buildQuizJSON(questionsData);
    downloadJSON(json, 'questoes.json');
  });
}
