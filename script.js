// Configuração do Worker do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let rawPdfTextContent = "";
let questionsData = [];
let currentQuestionIndex = 0;
let userAnswers = {};

// Função assíncrona para extrair todo o texto do PDF selecionado
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(" ");
    fullText += pageText + "\n\n";
  }

  return fullText;
}

// Limpeza de caracteres desnecessários
function cleanGarbage(text) {
  if (!text) return '';
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

// Extrai opções A, B, C, D, E e enunciado
function extractOptionsFromSlice(slice) {
  const optRegex = /(?:^|\n|\s+)(?:\(([A-E])\)|([A-E])[\.\)\-])\s+/g;
  const matches = [];
  let m;

  while ((m = optRegex.exec(slice)) !== null) {
    const letter = (m[1] || m[2]).toUpperCase();
    matches.push({ letter, index: m.index, matchLength: m[0].length });
  }

  let matchA = null, matchB = null, matchC = null, matchD = null, matchE = null;

  for (let item of matches) {
    if (item.letter === 'A' && !matchA) matchA = item;
    else if (item.letter === 'B' && matchA && !matchB && item.index > matchA.index) matchB = item;
    else if (item.letter === 'C' && matchB && !matchC && item.index > matchB.index) matchC = item;
    else if (item.letter === 'D' && matchC && !matchD && item.index > matchD.index) matchD = item;
    else if (item.letter === 'E' && matchD && !matchE && item.index > matchD.index) matchE = item;
  }

  if (matchA && matchB && matchC && matchD && matchE) {
    if ((matchE.index - matchA.index) > 2500) return { valid: false };

    const statement = slice.substring(0, matchA.index).trim();
    const optA = slice.substring(matchA.index + matchA.matchLength, matchB.index).trim();
    const optB = slice.substring(matchB.index + matchB.matchLength, matchC.index).trim();
    const optC = slice.substring(matchC.index + matchC.matchLength, matchD.index).trim();
    const optD = slice.substring(matchD.index + matchD.matchLength, matchE.index).trim();

    const restE = slice.substring(matchE.index + matchE.matchLength);
    let endEOffset = restE.search(/(?:\n\s*\n|\n?\s*(?:QUESTÃO|\d{1,2}\s*[\.\)\-])|\n?\s*CONHECIMENTOS)/i);
    if (endEOffset === -1 || endEOffset > 300) endEOffset = Math.min(restE.length, 250);
    const optE = restE.substring(0, endEOffset).trim();

    return {
      valid: true,
      statement: statement,
      options: {
        A: cleanGarbage(optA),
        B: cleanGarbage(optB),
        C: cleanGarbage(optC),
        D: cleanGarbage(optD),
        E: cleanGarbage(optE)
      }
    };
  }

  return { valid: false };
}

// Transforma o texto bruto da prova em objeto de questões
function parseExamQuestions(rawText) {
  const cleanText = cleanGarbage(rawText);
  const extracted = [];
  const qHeaderRegex = /(?:^|\n)\s*(?:QUESTÃO\s+)?(\d{1,2})\s*[\.\)\-]\s+/gi;
  let match;
  const candidates = [];

  while ((match = qHeaderRegex.exec(cleanText)) !== null) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 120) {
      candidates.push({ number: num, index: match.index, contentIndex: match.index + match[0].length });
    }
  }

  let activeSupportText = '';

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const nextIndex = candidates[i + 1] ? candidates[i + 1].index : cand.contentIndex + 2500;
    const searchSlice = cleanText.substring(cand.contentIndex, Math.min(cand.contentIndex + 2500, nextIndex));
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

// Configuração dos inputs de arquivo e Drag & Drop
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

// Renderização das Questões
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
