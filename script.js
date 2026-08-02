pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let rawPdfTextContent = "";     
let rawGabaritoTextContent = ""; 
let questionsData = [];
let currentQuestionIndex = 0;
let userAnswers = {};

// 1) EXTRAÇÃO DE TEXTO DO PDF (SUPORTE A 2 COLUNAS)
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    const midX = viewport.width / 2;

    const items = textContent.items
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter(it => it.str.trim() !== '');

    if (items.length === 0) continue;

    // Separa as colunas esquerda e direita
    const leftCol = items.filter(it => it.x < midX);
    const rightCol = items.filter(it => it.x >= midX);

    function processColumn(colItems) {
      if (colItems.length === 0) return "";
      colItems.sort((a, b) => b.y - a.y || a.x - b.x);
      
      const LINE_TOLERANCE = 4;
      const lines = [];
      let currentLine = [];
      let lastY = null;

      for (const it of colItems) {
        if (lastY === null || Math.abs(it.y - lastY) <= LINE_TOLERANCE) {
          currentLine.push(it);
        } else {
          lines.push(currentLine);
          currentLine = [it];
        }
        lastY = it.y;
      }
      if (currentLine.length) lines.push(currentLine);

      return lines
        .map(line => line.sort((a, b) => a.x - b.x).map(it => it.str).join(' '))
        .join('\n');
    }

    const leftText = processColumn(leftCol);
    const rightText = processColumn(rightCol);

    fullText += leftText + "\n" + rightText + "\n\n";
  }

  return fullText;
}

// 2) LIMPEZA DE TEXTO
function cleanGarbage(text) {
  if (!text) return '';
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

// 3) EXTRAÇÃO DE ALTERNATIVAS (A, B, C, D, E)
function extractOptionsFromSlice(slice) {
  // Aceita (A), A), A., A -
  const optRegex = /(?:^|\s|\n)(?:\(([A-E])\)|([A-E])\s*[\.\)\-])\s+/g;
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
    } else if (item.letter === 'D' && matchC && !matchD && item.index > matchD.index) {
      matchD = item;
    } else if (item.letter === 'E' && matchD && !matchE && item.index > matchD.index) {
      matchE = item;
    }
  }

  if (matchA && matchB && matchC && matchD && matchE) {
    const statement = slice.substring(0, matchA.index).trim();

    const optA = slice.substring(matchA.index + matchA.matchLength, matchB.index).trim();
    const optB = slice.substring(matchB.index + matchB.matchLength, matchC.index).trim();
    const optC = slice.substring(matchC.index + matchC.matchLength, matchD.index).trim();
    const optD = slice.substring(matchD.index + matchD.matchLength, matchE.index).trim();

    const restE = slice.substring(matchE.index + matchE.matchLength);
    let endEOffset = restE.search(/(?:\n\s*\n|\n?\s*(?:QUESTÃO|\d{1,3}\s*[\.\)\-])|\n?\s*CONHECIMENTOS)/i);
    if (endEOffset === -1 || endEOffset > 500) endEOffset = Math.min(restE.length, 400);
    const optE = restE.substring(0, endEOffset).trim();

    return {
      valid: true,
      statement,
      options: {
        A: cleanGarbage(optA) || "Opção A",
        B: cleanGarbage(optB) || "Opção B",
        C: cleanGarbage(optC) || "Opção C",
        D: cleanGarbage(optD) || "Opção D",
        E: cleanGarbage(optE) || "Opção E"
      }
    };
  }

  return { valid: false };
}

// 4) PARSER DA PROVA (FLEXÍVEL PARA CESGRANRIO)
function parseExamQuestions(rawText) {
  const cleanText = cleanGarbage(rawText);

  // Reconhece "QUESTÃO 1", "QUESTÃO 01", "1.", "1)", "1 -"
  const qHeaderRegex = /(?:^|\n)\s*(?:QUESTÃO\s+(\d{1,3})|(\d{1,3})\s*[\.\)\-:]\s+)/gi;
  let match;
  const candidates = [];

  while ((match = qHeaderRegex.exec(cleanText)) !== null) {
    const numStr = match[1] || match[2];
    const num = parseInt(numStr, 10);
    if (num >= 1 && num <= 120) {
      candidates.push({ number: num, index: match.index, contentIndex: match.index + match[0].length });
    }
  }

  const extracted = [];
  let activeSupportText = '';

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const nextIndex = candidates[i + 1] ? candidates[i + 1].index : cand.contentIndex + 4000;
    const searchSlice = cleanText.substring(cand.contentIndex, Math.min(cand.contentIndex + 4000, nextIndex));
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
        options: parsed.options,
        correctAnswer: null
      });
    }
  }

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

// 5) PARSERS DE GABARITO
function parseAnswerKeyFromPDF(rawText) {
  const cleanText = cleanGarbage(rawText);
  const keyRegex = /(\d{1,3})\s*[\.\)\-]?\s*([A-E])\b/g;
  const answerKey = {};
  let m;
  while ((m = keyRegex.exec(cleanText)) !== null) {
    const num = parseInt(m[1], 10);
    if (num >= 1 && num <= 120 && !(num in answerKey)) {
      answerKey[num] = m[2].toUpperCase();
    }
  }
  return answerKey;
}

function parseAnswerKeyFromTextarea(rawText) {
  const answerKey = {};
  if (!rawText || !rawText.trim()) return answerKey;

  const pairRegex = /(\d{1,3})\s*[-\.\):]?\s*([A-E])\b/gi;
  let m;
  while ((m = pairRegex.exec(rawText)) !== null) {
    const num = parseInt(m[1], 10);
    if (num >= 1 && num <= 120) {
      answerKey[num] = m[2].toUpperCase();
    }
  }
  return answerKey;
}

// 6) EXPORTAÇÃO JSON
function buildQuizJSON(questions) {
  return questions.map(q => ({
    id: q.number,
    materia: null,
    enunciado: q.supportText ? `${q.supportText}\n\n${q.text}` : q.text,
    alternativas: {
      a: q.options.A,
      b: q.options.B,
      c: q.options.C,
      d: q.options.D,
      e: q.options.E
    },
    resposta_correta: q.correctAnswer ? q.correctAnswer.toLowerCase() : null
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

// 7) EVENTOS DE UPLOAD DA PROVA
const pdfProvaInput = document.getElementById('pdfProvaInput');
const dropZoneProva = document.getElementById('dropZoneProva');
const statusProva = document.getElementById('statusProva');

async function handleProvaFile(file) {
  if (file && file.type === 'application/pdf') {
    statusProva.innerText = `⏳ Lendo e organizando arquivo: ${file.name}...`;
    try {
      rawPdfTextContent = await extractTextFromPDF(file);
      statusProva.innerText = `✅ Prova carregada com sucesso! (${file.name})`;
    } catch (err) {
      console.error(err);
      statusProva.innerText = `❌ Erro ao ler o PDF. Certifique-se de que não é uma imagem digitalizada.`;
    }
  }
}

if (pdfProvaInput) {
  pdfProvaInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleProvaFile(e.target.files[0]);
  });
}

if (dropZoneProva) {
  dropZoneProva.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneProva.classList.add('dragover'); });
  dropZoneProva.addEventListener('dragleave', () => dropZoneProva.classList.remove('dragover'));
  dropZoneProva.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZoneProva.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleProvaFile(e.dataTransfer.files[0]);
  });
}

// 8) EVENTOS DE UPLOAD DO GABARITO
const pdfGabaritoInput = document.getElementById('pdfGabaritoInput');
const dropZoneGabarito = document.getElementById('dropZoneGabarito');
const statusGabarito = document.getElementById('statusGabarito');
const gabaritoTextarea = document.getElementById('gabaritoTexto');

async function handleGabaritoFile(file) {
  if (file && file.type === 'application/pdf') {
    statusGabarito.innerText = `⏳ Lendo gabarito: ${file.name}...`;
    try {
      rawGabaritoTextContent = await extractTextFromPDF(file);
      statusGabarito.innerText = `✅ Gabarito carregado! (${file.name})`;
      if (gabaritoTextarea) gabaritoTextarea.value = '';
    } catch (err) {
      console.error(err);
      statusGabarito.innerText = `❌ Erro ao ler o PDF do gabarito.`;
    }
  }
}

if (pdfGabaritoInput) {
  pdfGabaritoInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleGabaritoFile(e.target.files[0]);
  });
}

if (dropZoneGabarito) {
  dropZoneGabarito.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneGabarito.classList.add('dragover'); });
  dropZoneGabarito.addEventListener('dragleave', () => dropZoneGabarito.classList.remove('dragover'));
  dropZoneGabarito.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZoneGabarito.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleGabaritoFile(e.dataTransfer.files[0]);
  });
}

// 9) RENDERIZAÇÃO DAS QUESTÕES
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

// 10) RESULTADO / FINALIZAR
function finishQuiz() {
  const hasAnswerKey = questionsData.some(q => q.correctAnswer);
  const total = questionsData.length;
  const answered = Object.keys(userAnswers).length;

  document.getElementById('quizScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.remove('hidden');

  const scoreEl = document.getElementById('resultScore');
  const listEl = document.getElementById('resultList');
  listEl.innerHTML = '';

  if (!hasAnswerKey) {
    scoreEl.innerText = `Você respondeu ${answered} de ${total} questões. Nenhum gabarito foi fornecido.`;
    return;
  }

  let correctCount = 0;

  questionsData.forEach(q => {
    const userAnswer = userAnswers[q.number] || null;
    const isCorrect = q.correctAnswer && userAnswer === q.correctAnswer;
    if (isCorrect) correctCount++;

    const item = document.createElement('div');
    item.className = `result-item ${q.correctAnswer ? (isCorrect ? 'correct' : 'wrong') : 'no-key'}`;
    item.innerHTML = `
      <span class="result-q-number">Q${q.number}</span>
      <span class="result-answer">Sua resposta: <strong>${userAnswer || '—'}</strong></span>
      <span class="result-answer">Gabarito: <strong>${q.correctAnswer || '—'}</strong></span>
    `;
    listEl.appendChild(item);
  });

  const gradable = questionsData.filter(q => q.correctAnswer).length;
  const percentage = gradable > 0 ? ((correctCount / gradable) * 100).toFixed(1) : '0.0';
  scoreEl.innerText = `Você acertou ${correctCount} de ${gradable} questões com gabarito (${percentage}%). Respondidas: ${answered} de ${total}.`;
}

// 11) INICIAR SIMULADO
document.getElementById('startBtn').addEventListener('click', () => {
  if (!rawPdfTextContent) {
    alert("Por favor, selecione ou arraste o PDF da prova antes de iniciar.");
    return;
  }

  questionsData = parseExamQuestions(rawPdfTextContent);

  if (questionsData.length === 0) {
    alert("Nenhuma questão em texto foi detectada. Verifique se o arquivo PDF contém texto selecionável (se for um PDF escaneado/foto, ele não funciona).");
    return;
  }

  let answerKey = {};
  if (rawGabaritoTextContent) {
    answerKey = parseAnswerKeyFromPDF(rawGabaritoTextContent);
  } else if (gabaritoTextarea && gabaritoTextarea.value.trim() !== '') {
    answerKey = parseAnswerKeyFromTextarea(gabaritoTextarea.value);
  }

  questionsData.forEach(q => {
    q.correctAnswer = answerKey[q.number] || null;
  });

  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('quizScreen').classList.remove('hidden');
  document.getElementById('resultScreen').classList.add('hidden');

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
    finishQuiz();
  }
});

const restartBtn = document.getElementById('restartBtn');
if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    document.getElementById('resultScreen').classList.add('hidden');
    document.getElementById('setupScreen').classList.remove('hidden');
  });
}

const exportBtn = document.getElementById('exportJsonBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const json = buildQuizJSON(questionsData);
    downloadJSON(json, 'questoes.json');
  });
}
