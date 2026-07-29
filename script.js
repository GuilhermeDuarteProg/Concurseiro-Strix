pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let questions = [];
let gabaritoMap = {};
let currentQuestionIndex = 0;
let userAnswers = {};
let timerInterval;
let secondsElapsed = 0;

let examFile = null;
let answerFile = null;

// Inputs e Listeners
document.getElementById('pdf-exam-input').addEventListener('change', (e) => {
    if (e.target.files.length) {
        examFile = e.target.files[0];
        document.getElementById('exam-file-name').textContent = examFile.name;
    }
});

document.getElementById('pdf-answer-input').addEventListener('change', (e) => {
    if (e.target.files.length) {
        answerFile = e.target.files[0];
        document.getElementById('answer-file-name').textContent = answerFile.name;
    }
});

async function processAndStart() {
    const statusMsg = document.getElementById('status-message');

    if (!examFile) {
        statusMsg.textContent = 'Por favor, selecione pelo menos o PDF da prova.';
        return;
    }

    statusMsg.textContent = 'Filtrando instruções e extraindo as questões... Aguarde.';

    try {
        const examText = await extractTextFromPDF(examFile);
        questions = parseExamQuestions(examText);

        if (questions.length === 0) {
            statusMsg.textContent = 'Não foi possível extrair as questões do PDF. Verifique o arquivo.';
            return;
        }

        gabaritoMap = {};
        if (answerFile) {
            const answerText = await extractTextFromPDF(answerFile);
            gabaritoMap = parseGabaritoText(answerText);
        }

        const manualText = document.getElementById('manual-gabarito').value;
        if (manualText.trim() !== '') {
            const manualMap = parseGabaritoText(manualText);
            gabaritoMap = { ...gabaritoMap, ...manualMap };
        }

        startQuiz();

    } catch (err) {
        console.error(err);
        statusMsg.textContent = 'Erro ao processar o arquivo PDF.';
    }
}

// DETECTOR DE REGRAS DE CAPA DA BANCA
function isInstructionBlock(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const instructionKeywords = [
        'será eliminado',
        'cartão-resposta',
        'cartão resposta',
        'cartãoresposta',
        'caderno de questões',
        'ausentar da sala',
        'recebeu do fiscal',
        'folha de respostas',
        'preenchimento dos círculos',
        'duração desta prova',
        'marcação das folhas',
        'lista de presença',
        'aparelhos sonoros'
    ];
    return instructionKeywords.some(keyword => lower.includes(keyword));
}

// CORRIGE PALAVRAS CORTADAS COM HÍFEN (Ex: "gru - pos" -> "grupos")
function fixHyphenatedWords(text) {
    if (!text) return '';
    return text.replace(/([a-zA-Z\u00C0-\u00FF]+)\s*-\s*([a-zA-Z\u00C0-\u00FF]+)/g, '$1$2');
}

// LIMPEZA RIGOROSA DE CABEÇALHOS E MARCAS D'ÁGUA
function cleanGarbage(text) {
    if (!text) return '';
    let clean = text;

    clean = clean.replace(/pcimarkpci\s*[A-Za-z0-9+/=]*/gi, '');
    clean = clean.replace(/[A-Za-z0-9+/=]{15,}==?/g, '');
    clean = clean.replace(/1\s*2\s*3\s*4\s*5\s*6\s*7\s*8\s*9\s*/g, '');
    clean = clean.replace(/www\.pciconcursos\.com\.br\s*(?:PROVA)?/gi, '');
    clean = clean.replace(/ADMINISTRAÇÃO\s*\d*\s*TERRA\s*TRANSPETRO\s*\d*/gi, '');
    clean = clean.replace(/CONHECIMENTOS\s+(?:ESPECÍFICOS|BÁSICOS|GERAIS)\s*\d*/gi, '');
    clean = clean.replace(/RACIOCÍNIO\s+LÓGICO(?:\s+MATEMÁTICO)?\s*\d*/gi, '');
    clean = clean.replace(/RASCUNHO\s*\d*/gi, '');
    clean = clean.replace(/PROVA\s+\d+/gi, '');

    clean = clean.replace(/\s+/g, ' ').trim();
    return fixHyphenatedWords(clean);
}

// BUSCADOR DE MARCADOR ESPECÍFICO DE QUESTÃO (Ex: Procura exatamente por Q3 para fechar Q2)
function findQuestionMarker(text, qNum) {
    if (!text) return null;
    const padded = String(qNum).padStart(2, '0');
    const numStr = String(qNum);

    const pattern = new RegExp(
        `(?:\\bQUESTÃO\\s*(?:${numStr}|${padded})\\b|\\b(?:${numStr}|${padded})\\s*[\\.\\)\\-]\\s*|\\b(?:${numStr}|${padded})\\s+(?=[A-Z\\u00C0-\\u00DC]))`,
        'i'
    );

    return pattern.exec(text);
}

// EXTRAÇÃO POR COLUNAS E LINHAS
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
                text += line.items.map(it => it.str).join(' ') + ' ';
            });
            return text;
        };

        fullText += sortByYandX(leftCol) + '\n' + sortByYandX(rightCol) + '\n';
    }

    return fullText;
}

// PARSER DE QUESTÕES COM BUSCA SEQUENCIAL DE NÚMEROS
function parseExamQuestions(rawText) {
    const clean = cleanGarbage(rawText);
    const extracted = [];

    const optionRegex = /(?:^|\s)(?:\(([A-E])\)|([A-E])[\.\)\-])\s+/gi;
    const matches = [];
    let match;

    while ((match = optionRegex.exec(clean)) !== null) {
        const letter = (match[1] || match[2]).toUpperCase();
        matches.push({
            letter: letter,
            index: match.index,
            length: match[0].length
        });
    }

    const blocks = [];
    for (let i = 0; i < matches.length; i++) {
        if (matches[i].letter === 'A') {
            const aMatch = matches[i];
            let bMatch = null, cMatch = null, dMatch = null, eMatch = null;

            for (let j = i + 1; j < matches.length; j++) {
                const m = matches[j];
                if (m.index - aMatch.index > 3500) break;

                if (!bMatch && m.letter === 'B') bMatch = m;
                else if (bMatch && !cMatch && m.letter === 'C') cMatch = m;
                else if (cMatch && !dMatch && m.letter === 'D') dMatch = m;
                else if (dMatch && !eMatch && m.letter === 'E') {
                    eMatch = m;
                    break;
                }
            }

            if (bMatch && cMatch && dMatch && eMatch) {
                blocks.push({ aMatch, bMatch, cMatch, dMatch, eMatch });
                i = matches.indexOf(eMatch);
            }
        }
    }

    let mainReadingText = '';

    for (let idx = 0; idx < blocks.length; idx++) {
        const currentQNum = idx + 1;
        const block = blocks[idx];

        let statement = '';
        if (idx === 0) {
            const rawPreceding = clean.substring(0, block.aMatch.index);
            const qMatch = findQuestionMarker(rawPreceding, currentQNum);

            if (qMatch) {
                const supportCandidate = rawPreceding.substring(0, qMatch.index).trim();
                if (supportCandidate.length > 100 && !isInstructionBlock(supportCandidate)) {
                    mainReadingText = supportCandidate;
                }
                statement = rawPreceding.substring(qMatch.index + qMatch[0].length).trim();
            } else {
                statement = rawPreceding.replace(/^(?:QUESTÃO\s*\d{1,2}|\d{1,2}\s*[\.\)-]?\s*)/i, '').trim();
            }
        } else {
            statement = block.extractedStatement || '';
        }

        statement = cleanGarbage(statement);

        let optA = cleanGarbage(clean.substring(block.aMatch.index + block.aMatch.length, block.bMatch.index));
        let optB = cleanGarbage(clean.substring(block.bMatch.index + block.bMatch.length, block.cMatch.index));
        let optC = cleanGarbage(clean.substring(block.cMatch.index + block.cMatch.length, block.dMatch.index));
        let optD = cleanGarbage(clean.substring(block.dMatch.index + block.dMatch.length, block.eMatch.index));

        let optE = '';
        const eStart = block.eMatch.index + block.eMatch.length;

        if (idx < blocks.length - 1) {
            const nextQNum = currentQNum + 1;
            const nextBlock = blocks[idx + 1];
            const subText = clean.substring(eStart, nextBlock.aMatch.index);

            const qNextMatch = findQuestionMarker(subText, nextQNum);

            if (qNextMatch) {
                optE = clean.substring(eStart, eStart + qNextMatch.index);
                nextBlock.extractedStatement = subText.substring(qNextMatch.index + qNextMatch[0].length);
            } else {
                const fallbackMatch = subText.match(/(?:\bQUESTÃO\s*\d{1,2}\b|\b\d{1,2}\s*[\.\)-]\s*)/i);
                if (fallbackMatch) {
                    optE = clean.substring(eStart, eStart + fallbackMatch.index);
                    nextBlock.extractedStatement = subText.substring(fallbackMatch.index + fallbackMatch[0].length);
                } else {
                    optE = subText;
                    nextBlock.extractedStatement = '';
                }
            }
        } else {
            let endOfText = clean.length;
            const subText = clean.substring(eStart);
            const gabMatch = subText.search(/(?:GABARITO|PROVA\s+CONCLUÍDA|PCI\s*CONCURSOS)/i);
            if (gabMatch !== -1) {
                endOfText = eStart + gabMatch;
            }
            optE = clean.substring(eStart, endOfText);
        }

        optE = cleanGarbage(optE);

        const isInstruction = isInstructionBlock(statement) ||
                              isInstructionBlock(optA) ||
                              isInstructionBlock(optB) ||
                              isInstructionBlock(optC) ||
                              isInstructionBlock(optD) ||
                              isInstructionBlock(optE);

        if (!isInstruction && statement.length > 3 && optA && optB && optC && optD && optE) {
            extracted.push({
                text: statement,
                supportText: mainReadingText,
                options: {
                    A: optA,
                    B: optB,
                    C: optC,
                    D: optD,
                    E: optE
                }
            });
        }
    }

    return extracted;
}

function parseGabaritoText(text) {
    const map = {};
    const regex = /(\b\d{1,2}\b)\s*[\-\:\.\)\s]+\s*([A-E])\b/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const qNum = parseInt(match[1], 10);
        const letter = match[2].toUpperCase();
        map[qNum] = letter;
    }

    return map;
}

function startQuiz() {
    document.getElementById('upload-section').style.display = 'none';
    document.getElementById('quiz-section').style.display = 'block';

    currentQuestionIndex = 0;
    userAnswers = {};
    secondsElapsed = 0;

    startTimer();
    renderQuestion();
}

function renderQuestion() {
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
        if (qTextEl) {
            const parentCard = qTextEl.closest('.card-questao') || qTextEl.parentElement.parentElement || qTextEl.parentElement;
            parentCard.insertBefore(supportContainer, parentCard.firstChild);
        }
    }

    if (q.supportText && q.supportText.trim() !== '') {
        supportContainer.innerHTML = `<strong style="color: #a78bfa; display: block; margin-bottom: 8px; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.5px;">📖 Texto de Referência:</strong>${q.supportText}`;
        supportContainer.style.display = 'block';
    } else {
        supportContainer.style.display = 'none';
    }

    document.getElementById('q-number').textContent = String(currentQuestionIndex + 1).padStart(2, '0');
    document.getElementById('q-text').textContent = q.text;

    const container = document.getElementById('options-container');
    container.innerHTML = '';

    ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
        if (q.options[letter]) {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            if (userAnswers[currentQuestionIndex] === letter) btn.classList.add('selected');

            btn.innerHTML = `<span class="badge">${letter}</span><span>${q.options[letter]}</span>`;
            btn.onclick = () => {
                userAnswers[currentQuestionIndex] = letter;
                renderQuestion();
            };
            container.appendChild(btn);
        }
    });

    document.getElementById('btn-prev').style.display = currentQuestionIndex === 0 ? 'none' : 'inline-block';
    
    if (currentQuestionIndex === questions.length - 1) {
        document.getElementById('btn-next').style.display = 'none';
        document.getElementById('btn-finish').style.display = 'inline-block';
    } else {
        document.getElementById('btn-next').style.display = 'inline-block';
        document.getElementById('btn-finish').style.display = 'none';
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

function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const hrs = String(Math.floor(secondsElapsed / 3600)).padStart(2, '0');
        const mins = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(2, '0');
        const secs = String(secondsElapsed % 60).padStart(2, '0');
        document.getElementById('timer').textContent = `${hrs}:${mins}:${secs}`;
    }, 1000);
}

function finishQuiz() {
    clearInterval(timerInterval);
    document.getElementById('quiz-section').style.display = 'none';
    document.getElementById('result-section').style.display = 'block';

    let correctCount = 0;
    let incorrectCount = 0;
    const reviewList = document.getElementById('review-list');
    reviewList.innerHTML = '';

    questions.forEach((q, idx) => {
        const qNum = idx + 1;
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

        const item = document.createElement('div');
        item.className = `review-item ${statusClass}`;
        item.innerHTML = `
            <div>
                <strong>Questão ${String(qNum).padStart(2, '0')}</strong><br>
                Sua resposta: <strong>${userAns}</strong>
            </div>
            <div style="text-align: right;">
                Gabarito Oficial: <strong class="txt-success">${officialAns}</strong>
            </div>
        `;
        reviewList.appendChild(item);
    });

    const total = questions.length;
    const percentage = total > 0 && Object.keys(gabaritoMap).length > 0 
        ? Math.round((correctCount / total) * 100) 
        : 0;

    document.getElementById('score-percentage').textContent = `${percentage}%`;
    document.getElementById('correct-count').textContent = correctCount;
    document.getElementById('incorrect-count').textContent = incorrectCount;
    document.getElementById('answered-count').textContent = Object.keys(userAnswers).length;
    document.getElementById('total-count').textContent = total;
}
