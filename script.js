// Configuração do Worker do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Estado global da aplicação
let questions = [];
let gabaritoMap = {};
let currentQuestionIndex = 0;
let userAnswers = {};
let timerInterval = null;
let secondsElapsed = 0;

let examFile = null;
let answerFile = null;

// Inicialização de ouvintes de eventos
document.addEventListener('DOMContentLoaded', () => {
    const examInput = document.getElementById('pdf-exam-input');
    const answerInput = document.getElementById('pdf-answer-input');

    if (examInput) {
        examInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                examFile = e.target.files[0];
                const nameEl = document.getElementById('exam-file-name');
                if (nameEl) nameEl.textContent = examFile.name;
            }
        });
    }

    if (answerInput) {
        answerInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                answerFile = e.target.files[0];
                const nameEl = document.getElementById('answer-file-name');
                if (nameEl) nameEl.textContent = answerFile.name;
            }
        });
    }
});

// Helper para escapar HTML e prevenir XSS/quebras de layout
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Corrige apenas hífens de quebra de linha
function fixHyphenatedWords(text) {
    if (!text) return '';
    return text.replace(/([a-zA-Z\u00C0-\u00FF]+)-\s*\n\s*([a-zA-Z\u00C0-\u00FF]+)/g, '$1$2');
}

// Limpeza segura de cabeçalhos, rodapés e marcas d'água
function cleanGarbage(text) {
    if (!text) return '';
    let clean = text;

    clean = clean.replace(/pcimarkpci\s*[A-Za-z0-9+/=]*/gi, '');
    clean = clean.replace(/[A-Za-z0-9+/=]{20,}==?/g, '');
    clean = clean.replace(/www\.pciconcursos\.com\.br/gi, '');

    clean = clean.replace(/PROVA\s+\d*[\s\-]*ADMINISTRAÇÃO/gi, '');
    clean = clean.replace(/BR\s+PETROBRAS\s+TRANSPORTE\s+S\.\s*A\./gi, '');
    clean = clean.replace(/TRANSPETRO/gi, '');
    clean = clean.replace(/FUNDAÇÃO\s+CESGRANRIO/gi, '');
    clean = clean.replace(/RASCUNHO/gi, '');
    clean = clean.replace(/Continua\b/gi, '');

    clean = fixHyphenatedWords(clean);
    clean = clean.replace(/[ \t]+/g, ' ').trim();
    return clean;
}

// EXTRAÇÃO POR COLUNAS E LINHAS DO PDF (COM ORDENAÇÃO DE LEITURA)
async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();

        const midX = viewport.width / 2;
        const leftCol = [];
        const rightCol = [];

        textContent.items.forEach(item => {
            if (!item.str || !item.str.trim()) return;
            const x = item.transform[4];
            const y = item.transform[5];

            if (x < midX) {
                leftCol.push({ str: item.str, y, x });
            } else {
                rightCol.push({ str: item.str, y, x });
            }
        });

        const sortByYandX = (items) => {
            const lines = [];
            items.forEach(item => {
                let line = lines.find(l => Math.abs(l.y - item.y) < 4);
                if (line) {
                    line.items.push(item);
                } else {
                    lines.push({ y: item.y, items: [item] });
                }
            });

            lines.sort((a, b) => b.y - a.y);

            let text = '';
            lines.forEach(line => {
                line.items.sort((a, b) => a.x - b.x);
                text += line.items.map(it => it.str).join(' ') + '\n';
            });
            return text;
        };

        fullText += sortByYandX(leftCol) + '\n' + sortByYandX(rightCol) + '\n';
    }

    return fullText;
}

// PARSER ROBUSTO DE QUESTÕES COM DETECÇÃO E ORDENAÇÃO NUMÉRICA ESTRITA
function parseExamQuestions(rawText) {
    const cleanText = cleanGarbage(rawText);
    const extracted = [];

    // Verifica se a palavra "QUESTÃO" é usada no PDF para criar um filtro mais rigoroso
    const hasQuestaoKeyword = /QUESTÃO\s*\d{1,2}/i.test(cleanText);

    // Se houver a palavra QUESTÃO no PDF, usamos rigor máximo para evitar falsos positivos
    const qHeaderRegex = hasQuestaoKeyword 
        ? /(?:^|\n|\s+)(?:QUESTÃO)\s*(\d{1,2})\b/gi
        : /(?:^|\n)\s*(\d{1,2})\s*[\.\)\-]\s+(?=[A-Z\u00C0-\u00DC\“\"\'\(\d])/gi;

    const qMatches = [];
    let match;

    while ((match = qHeaderRegex.exec(cleanText)) !== null) {
        const qNum = parseInt(match[1], 10);
        // Descarta números maiores que 120 (prováveis erros de leitura)
        if (qNum > 0 && qNum <= 120) {
            qMatches.push({
                number: qNum,
                index: match.index,
                length: match[0].length
            });
        }
    }

    if (qMatches.length === 0) return [];

    let currentSupportText = '';

    for (let i = 0; i < qMatches.length; i++) {
        const qCurr = qMatches[i];
        const startIndex = qCurr.index + qCurr.length;
        const endIndex = (i < qMatches.length - 1) ? qMatches[i + 1].index : cleanText.length;
        
        const rawBlock = cleanText.substring(startIndex, endIndex).trim();

        // Identifica alternativas (A, B, C, D, E)
        const optRegex = /(?:^|\s)\(?([A-E])\)[\.\-]?\s+/gi;
        const optMatches = [];
        let optMatch;

        while ((optMatch = optRegex.exec(rawBlock)) !== null) {
            optMatches.push({
                letter: optMatch[1].toUpperCase(),
                index: optMatch.index
            });
        }

        // Filtra e valida sequência A -> B -> C -> D -> E
        let aIndex = -1, bIndex = -1, cIndex = -1, dIndex = -1, eIndex = -1;
        for (let m of optMatches) {
            if (m.letter === 'A' && aIndex === -1) aIndex = m.index;
            else if (m.letter === 'B' && aIndex !== -1 && bIndex === -1) bIndex = m.index;
            else if (m.letter === 'C' && bIndex !== -1 && cIndex === -1) cIndex = m.index;
            else if (m.letter === 'D' && cIndex !== -1 && dIndex === -1) dIndex = m.index;
            else if (m.letter === 'E' && dIndex !== -1 && eIndex === -1) eIndex = m.index;
        }

        // Se encontrou as alternativas corretamente
        if (aIndex !== -1 && bIndex !== -1 && cIndex !== -1 && dIndex !== -1 && eIndex !== -1) {
            let statementAndSupport = rawBlock.substring(0, aIndex).trim();
            
            // Verifica se existe cabeçalho de texto de apoio
            const textHeaderMatch = statementAndSupport.match(/(?:\bTEXTO\s+[I|V|X\d]*|\bREAD\s+THE\s+TEXT|\bLEIA\s+O\s+TEXTO)/i);
            
            let statement = statementAndSupport;
            if (textHeaderMatch) {
                const headerIdx = textHeaderMatch.index;
                if (headerIdx > 0) {
                    currentSupportText = statementAndSupport.substring(headerIdx).trim();
                    statement = statementAndSupport.substring(0, headerIdx).trim();
                } else {
                    currentSupportText = statementAndSupport;
                    statement = '';
                }
            }

            const optA = rawBlock.substring(aIndex, bIndex).replace(/^(?:\(A\)|A[\.\)\-])\s*/i, '').trim();
            const optB = rawBlock.substring(bIndex, cIndex).replace(/^(?:\(B\)|B[\.\)\-])\s*/i, '').trim();
            const optC = rawBlock.substring(cIndex, dIndex).replace(/^(?:\(C\)|C[\.\)\-])\s*/i, '').trim();
            const optD = rawBlock.substring(dIndex, eIndex).replace(/^(?:\(D\)|D[\.\)\-])\s*/i, '').trim();
            const optE = rawBlock.substring(eIndex).replace(/^(?:\(E\)|E[\.\)\-])\s*/i, '').trim();

            extracted.push({
                number: qCurr.number,
                text: statement || `Questão ${qCurr.number}`,
                supportText: currentSupportText,
                options: {
                    A: cleanGarbage(optA),
                    B: cleanGarbage(optB),
                    C: cleanGarbage(optC),
                    D: cleanGarbage(optD),
                    E: cleanGarbage(optE)
                }
            });
        }
    }

    // CORREÇÃO CRÍTICA 1: Ordenação numérica crescente obrigatória (1, 2, 3...)
    extracted.sort((a, b) => a.number - b.number);

    // CORREÇÃO CRÍTICA 2: Remoção de duplicatas de números de questões
    const uniqueQuestions = [];
    const seenNumbers = new Set();

    for (const q of extracted) {
        if (!seenNumbers.has(q.number)) {
            seenNumbers.add(q.number);
            uniqueQuestions.push(q);
        }
    }

    return uniqueQuestions;
}

// PARSER DE GABARITO AMPLIADO E ROBUSTO
function parseGabaritoText(text) {
    if (!text) return {};
    const map = {};
    const clean = text.replace(/\r?\n/g, ' ');
    
    // Suporta formatos: "1-A", "01. B", "1 A", "1: C", "1) D", "QUESTÃO 1 - A"
    const regex = /(?:^|\s|;|,|\|)(?:QUESTÃO\s*)?(\d{1,2})\s*[\-\:\.\)\s]+\s*([A-E])(?=\s|$|;|,|\||\d)/gi;
    let match;

    while ((match = regex.exec(clean)) !== null) {
        const qNum = parseInt(match[1], 10);
        const letter = match[2].toUpperCase();
        if (qNum >= 1 && qNum <= 120) {
            map[qNum] = letter;
        }
    }

    return map;
}

// PROCESSA OS ARQUIVOS E INICIA
async function processAndStart() {
    const statusMsg = document.getElementById('status-message');

    if (!examFile) {
        if (statusMsg) statusMsg.textContent = 'Por favor, selecione pelo menos o PDF da prova.';
        return;
    }

    if (statusMsg) statusMsg.textContent = 'Extraindo e organizando as questões do PDF... Aguarde.';

    try {
        const examText = await extractTextFromPDF(examFile);
        questions = parseExamQuestions(examText);

        if (questions.length === 0) {
            if (statusMsg) statusMsg.textContent = 'Não foi possível extrair as questões do PDF. Verifique se o arquivo é válido.';
            return;
        }

        gabaritoMap = {};
        if (answerFile) {
            const answerText = await extractTextFromPDF(answerFile);
            gabaritoMap = parseGabaritoText(answerText);
        }

        const manualInput = document.getElementById('manual-gabarito');
        if (manualInput && manualInput.value.trim() !== '') {
            const manualMap = parseGabaritoText(manualInput.value);
            gabaritoMap = { ...gabaritoMap, ...manualMap };
        }

        startQuiz();

    } catch (err) {
        console.error("Erro durante o processamento:", err);
        if (statusMsg) statusMsg.textContent = 'Erro ao processar o arquivo PDF. Tente novamente.';
    }
}

// INICIA O SIMULADO
function startQuiz() {
    const uploadSec = document.getElementById('upload-section');
    const quizSec = document.getElementById('quiz-section');

    if (uploadSec) uploadSec.style.display = 'none';
    if (quizSec) quizSec.style.display = 'block';

    currentQuestionIndex = 0;
    userAnswers = {};
    secondsElapsed = 0;

    startTimer();
    renderQuestion();
}

// RENDERIZA A QUESTÃO ATUAL NO DOM
function renderQuestion() {
    if (!questions || questions.length === 0) return;

    const q = questions[currentQuestionIndex];

    let supportContainer = document.getElementById('texto-apoio-container');
    if (!supportContainer) {
        supportContainer = document.createElement('div');
        supportContainer.id = 'texto-apoio-container';
        supportContainer.style.cssText = `
            width: 100%;
            background-color: #1a1528;
            border-left: 4px solid #8b5cf6;
            padding: 16px;
            margin-bottom: 20px;
            border-radius: 8px;
            font-size: 0.95rem;
            line-height: 1.6;
            color: #e2e8f0;
            max-height: 280px;
            overflow-y: auto;
            white-space: pre-line;
            box-sizing: border-box;
        `;
        
        const qTextEl = document.getElementById('q-text');
        if (qTextEl && qTextEl.parentElement) {
            qTextEl.parentElement.insertBefore(supportContainer, qTextEl);
        }
    }

    if (q.supportText && q.supportText.trim() !== '') {
        supportContainer.innerHTML = `<strong style="color: #a78bfa; display: block; margin-bottom: 8px; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.5px;">📖 Texto de Referência:</strong>${escapeHtml(q.supportText)}`;
        supportContainer.style.display = 'block';
    } else if (supportContainer) {
        supportContainer.style.display = 'none';
    }

    const qNumEl = document.getElementById('q-number');
    const qTextEl = document.getElementById('q-text');

    if (qNumEl) qNumEl.textContent = String(q.number || (currentQuestionIndex + 1)).padStart(2, '0');
    if (qTextEl) qTextEl.textContent = q.text;

    const container = document.getElementById('options-container');
    if (container) {
        container.innerHTML = '';

        ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
            if (q.options[letter]) {
                const btn = document.createElement('button');
                btn.className = 'option-btn';
                if (userAnswers[currentQuestionIndex] === letter) btn.classList.add('selected');

                btn.innerHTML = `<span class="badge">${letter}</span><span>${escapeHtml(q.options[letter])}</span>`;
                btn.onclick = () => {
                    userAnswers[currentQuestionIndex] = letter;
                    renderQuestion();
                };
                container.appendChild(btn);
            }
        });
    }

    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnFinish = document.getElementById('btn-finish');

    if (btnPrev) btnPrev.style.display = currentQuestionIndex === 0 ? 'none' : 'inline-block';
    
    if (currentQuestionIndex === questions.length - 1) {
        if (btnNext) btnNext.style.display = 'none';
        if (btnFinish) btnFinish.style.display = 'inline-block';
    } else {
        if (btnNext) btnNext.style.display = 'inline-block';
        if (btnFinish) btnFinish.style.display = 'none';
    }
}

function nextQuestion() {
    if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        renderQuestion();
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderQuestion();
    }
}

// CRONÔMETRO
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const hrs = String(Math.floor(secondsElapsed / 3600)).padStart(2, '0');
        const mins = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(2, '0');
        const secs = String(secondsElapsed % 60).padStart(2, '0');
        
        const timerEl = document.getElementById('timer');
        if (timerEl) timerEl.textContent = `${hrs}:${mins}:${secs}`;
    }, 1000);
}

// CONCLUI O SIMULADO E EXIBE RESULTADOS
function finishQuiz() {
    if (timerInterval) clearInterval(timerInterval);

    const quizSec = document.getElementById('quiz-section');
    const resultSec = document.getElementById('result-section');

    if (quizSec) quizSec.style.display = 'none';
    if (resultSec) resultSec.style.display = 'block';

    let correctCount = 0;
    let incorrectCount = 0;
    const reviewList = document.getElementById('review-list');
    if (reviewList) reviewList.innerHTML = '';

    questions.forEach((q, idx) => {
        const qNum = q.number ? q.number : (idx + 1);
        const userAns = userAnswers[idx] || 'Não respondida';
        const officialAns = gabaritoMap[qNum] || 'N/D';

        let statusClass = '';
        if (officialAns !== 'N/D') {
            if (userAns === officialAns) {
                correctCount++;
                statusClass = 'is-correct';
            } else {
                incorrectCount++;
                statusClass = 'is-incorrect';
            }
        }

        if (reviewList) {
            const item = document.createElement('div');
            item.className = `review-item ${statusClass}`;
            item.innerHTML = `
                <div>
                    <strong>Questão ${String(qNum).padStart(2, '0')}</strong><br>
                    Sua resposta: <strong>${escapeHtml(userAns)}</strong>
                </div>
                <div style="text-align: right;">
                    Gabarito Oficial: <strong class="txt-success">${escapeHtml(officialAns)}</strong>
                </div>
            `;
            reviewList.appendChild(item);
        }
    });

    const total = questions.length;
    const answeredWithGabarito = Object.keys(gabaritoMap).length;
    const percentage = total > 0 && answeredWithGabarito > 0 
        ? Math.round((correctCount / total) * 100) 
        : 0;

    const scoreEl = document.getElementById('score-percentage');
    const correctEl = document.getElementById('correct-count');
    const incorrectEl = document.getElementById('incorrect-count');
    const answeredEl = document.getElementById('answered-count');
    const totalEl = document.getElementById('total-count');

    if (scoreEl) scoreEl.textContent = `${percentage}%`;
    if (correctEl) correctEl.textContent = correctCount;
    if (incorrectEl) incorrectEl.textContent = incorrectCount;
    if (answeredEl) answeredEl.textContent = Object.keys(userAnswers).length;
    if (totalEl) totalEl.textContent = total;
}
