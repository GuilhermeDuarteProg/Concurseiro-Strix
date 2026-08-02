pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let questionsData = [];
let currentQuestionIndex = 0;
let userAnswers = {};

// 1. EXTRAÇÃO DE TEXTO DO PDF (IGNORA A CAPA DE INSTRUÇÕES)
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

    const pageStr = items.map(it => it.str).join(' ');

    // Se for a Página 1 e for apenas a capa/instruções sem "QUESTÃO 1", ignora a página 1
    if (i === 1 && (pageStr.includes("CADERNO DE QUESTÕES") || pageStr.includes("INSTRUÇÕES"))) {
      if (!/QUESTÃO\s+0?1\b/i.test(pageStr)) {
        continue; // Descarta capa
      }
    }

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

    fullText += processColumn(leftCol) + "\n" + processColumn(rightCol) + "\n\n";
  }

  // Descarta qualquer resíduo antes da QUESTÃO 1 (ou do TEXTO I anterior à Q1)
  const q1Match = fullText.match(/QUESTÃO\s+0?1\b/i);
  if (q1Match) {
    const textBeforeQ1 = fullText.substring(0, q1Match.index);
    const textoMatch = textBeforeQ1.match(/(TEXTO\s+[I|V|X\d]+[\s\S]*)/i);
    if (textoMatch) {
      fullText = fullText.substring(textoMatch.index);
    } else {
      fullText = fullText.substring(q1Match.index);
    }
  }

  return fullText;
}

// 2. PARSER RÍGIDO E INTELIGENTE CESGRANRIO
function parseExamQuestions(cleanText) {
  if (!cleanText || cleanText.length < 50) return [];

  // Busca estritamente a palavra "QUESTÃO X"
  const qHeaderRegex = /(?:^|\n)\s*QUESTÃO\s+(\d{1,3})\b/gi;
  let match;
  const matches = [];

  while ((match = qHeaderRegex.exec(cleanText)) !== null) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 120) {
      matches.push({ number: num, index: match.index, headerLen: match[0].length });
    }
  }

  if (matches.length === 0) return [];

  const questions = [];
  let currentSupportText = "";

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = matches[i + 1] ? matches[i + 1].index : cleanText.length;
    const chunk = cleanText.substring(current.index + current.headerLen, nextIndex).trim();

    // Identifica textos de apoio (ex: TEXTO I, TEXTO II)
    const textHeaderMatch = chunk.match(/(TEXTO\s+[I|V|X\d]+[\s\S]*?)(?=\n\s*[A-Z0-9\s]{3,}\n|\n\s*QUESTÃO|\n\s*\(?[A-E]\)?)/i);
    
    let statementAndOptions = chunk;
    if (textHeaderMatch) {
      currentSupportText = textHeaderMatch[1].trim();
      statementAndOptions = chunk.replace(textHeaderMatch[1], '').trim();
    }

    // Busca opções no formato (A), (B), (C), (D), (E)
    const optRegex = /(?:^|\n|\s+)\(([A-E])\)\s+/g;
    let optMatch;
    const optPositions = [];

    while ((optMatch = optRegex.exec(statementAndOptions)) !== null) {
      optPositions.push({ letter: optMatch[1].toUpperCase(), index: optMatch.index, length: optMatch[0].length });
    }

    const optionsMap = { A: '', B: '', C: '', D: '', E: '' };
    let statement = statementAndOptions;

    if (optPositions.length >= 2) {
      statement = statementAndOptions.substring(0, optPositions[0].index).trim();

      for (let j = 0; j < optPositions.length; j++) {
        const curOpt = optPositions[j];
        const nextOptIndex = optPositions[j + 1] ? optPositions[j + 1].index : statementAndOptions.length;
        const optText = statementAndOptions.substring(curOpt.index + curOpt.length, nextOptIndex).trim();
        if (optionsMap[curOpt.letter] === '') {
          optionsMap[curOpt.letter] = optText.replace(/\n+/g, ' ');
        }
      }
    }

    ['A', 'B', 'C', 'D', 'E'].forEach(l => {
      if (!optionsMap[l]) optionsMap[l] = `(Verifique no PDF a opção ${l})`;
    });

    questions.push({
      number: current.number,
      text: statement.replace(/\n+/g, ' ') || `Questão ${current.number}`,
      supportText: currentSupportText,
      options: optionsMap,
      correctAnswer: null
    });
  }

  const uniqueQuestions = [];
  const seen = new Set();
  for (const q of questions) {
    if (!seen.has(q.number)) {
      seen.add(q.number);
      uniqueQuestions.push(q);
    }
  }

  return uniqueQuestions.sort((a, b) => a.number - b.number);
}

// 3. EVENTO DE CARREGAMENTO (SUPORTA .PDF OU .JSON)
const pdfProvaInput = document.getElementById('pdfProvaInput');
const statusProva = document.getElementById('statusProva');
let rawPdfTextContent = "";

async function handleProvaFile(file) {
  if (!file) return;

  // ACEITA ARQUIVOS .JSON DIRETAMENTE
  if (file.name.endsWith('.json')) {
    statusProva.innerText = `⏳ Lendo JSON: ${file.name}...`;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        questionsData = json.map(q => ({
          number: q.id || q.number,
          text: q.enunciado || q.text,
          supportText: q.texto_apoio || q.supportText || '',
          options: {
            A: q.alternativas?.a || q.options?.A || '',
            B: q.alternativas?.b || q.options?.B || '',
            C: q.alternativas?.c || q.options?.C || '',
            D: q.alternativas?.d || q.options?.D || '',
            E: q.alternativas?.e || q.options?.E || ''
          },
          correctAnswer: q.resposta_correta ? q.resposta_correta.toUpperCase() : null
        }));
        statusProva.innerText = `✅ JSON carregado! (${questionsData.length} questões encontradas)`;
      } catch (err) {
        statusProva.innerText = `❌ Erro ao processar o arquivo JSON.`;
      }
    };
    reader.readAsText(file);
    return;
  }

  // ACEITA PDFS E APENAS COMEÇA DA QUESTÃO 1
  if (file.type === 'application/pdf') {
    statusProva.innerText = `⏳ Lendo e filtrando PDF: ${file.name}...`;
    try {
      rawPdfTextContent = await extractTextFromPDF(file);
      questionsData = parseExamQuestions(rawPdfTextContent);

      if (questionsData.length === 0) {
        statusProva.innerText = `⚠️ Nenhuma questão foi lida. Certifique-se de que o PDF não é uma imagem/foto digitalizada.`;
      } else {
        statusProva.innerText = `✅ Prova processada com sucesso! (${questionsData.length} questões carregadas)`;
      }
    } catch (err) {
      console.error(err);
      statusProva.innerText = `❌ Erro ao ler PDF.`;
    }
  }
}

if (pdfProvaInput) {
  pdfProvaInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleProvaFile(e.target.files[0]);
  });
}

// 4. EXIBIÇÃO DAS QUESTÕES E TEXTO DE APOIO
function renderQuestion(index) {
  if (!questionsData || !questionsData[index]) return;

  const q = questionsData[index];
  document.getElementById('questionCounter').innerText = `Questão ${q.number}`;
  document.getElementById('totalCounter').innerText = `${index + 1} de ${questionsData.length}`;
  
  // Renderiza caixa do Texto de Apoio / Interpretação se existir
  let supportTextEl = document.getElementById('supportTextDisplay');
  if (!supportTextEl) {
    const qContainer = document.getElementById('questionText').parentElement;
    supportTextEl = document.createElement('div');
    supportTextEl.id = 'supportTextDisplay';
    supportTextEl.style.cssText = 'background: #1e1b4b; border-left: 4px solid #6366f1; padding: 1rem; border-radius: 8px; margin-bottom: 1.2rem; font-size: 0.95rem; white-space: pre-wrap; color: #e0e7ff; line-height: 1.5;';
    qContainer.insertBefore(supportTextEl, document.getElementById('questionText'));
  }

  if (q.supportText && q.supportText.trim() !== '') {
    supportTextEl.innerText = q.supportText;
    supportTextEl.style.display = 'block';
  } else {
    supportTextEl.style.display = 'none';
  }

  document.getElementById('questionText').innerText = q.text;

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

// 5. NAVEGAÇÃO
document.getElementById('startBtn').addEventListener('click', () => {
  if (questionsData.length === 0) {
    alert("Nenhuma questão foi carregada. Escolha o PDF da prova ou um arquivo JSON.");
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
    finishQuiz();
  }
});

function finishQuiz() {
  document.getElementById('quizScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.remove('hidden');
  document.getElementById('resultScore').innerText = `Simulado concluído! Você respondeu ${Object.keys(userAnswers).length} de ${questionsData.length} questões.`;
}
