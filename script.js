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

// DETECTOR DE REGRAS DE CAPA DA BANCA (Regras administrativas estritas)
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

// PARSER DE QUESTÕES PRECISO E SEQUENCIAL
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

    let lastEIndex = 0;
    let mainReadingText = ''; // Armazena o texto principal de interpretação (crônica/artigo)

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
                let endOfE = clean.length;
                const nextAMatch = matches.find(m => m.letter === 'A' && m.index > eMatch.index);
                if (nextAMatch) {
                    const subText = clean.substring(eMatch.index + eMatch.length, nextAMatch.index);
                    const nextQInSub = subText.search(/(?:\bQUESTÃO\s+\d{1,2}\b|\b\d{1,2}\s*[\.\)-]?\s+[A-Z\u00C0-\u00DC])/i);
                    if (nextQInSub !== -1) {
                        endOfE = eMatch.index + eMatch.length + nextQInSub;
                    } else {
                        endOfE = nextAMatch.index;
                    }
                }

                blocks.push({
                    precedingText: clean.substring(lastEIndex, aMatch.index).trim(),
                    aMatch, bMatch, cMatch, dMatch, eMatch,
                    endOfE
                });

                lastEIndex = endOfE;
                i = matches.indexOf(eMatch);
            }
        }
    }

    // Processamento sequencial buscando exatamente a questão atual (1, 2, 3...)
    blocks.forEach((block, index) => {
        const expectedQNum = index + 1;
        let rawPreceding = block.precedingText;

        // Busca especificamente pelo número sequencial exato da questão
        const numRegex = new RegExp(`(?:\\bQUESTÃO\\s*0?${expectedQNum}\\b|\\b0?${expectedQNum}\\s*[\\.\\)\\-]\\s*)`, 'i');
        const numMatch = rawPreceding.match(numRegex);

        let supportBeforeThis = '';
        let statement = rawPreceding;

        if (numMatch && numMatch.index !== undefined) {
            supportBeforeThis = rawPreceding.substring(0, numMatch.index).trim();
            statement = rawPreceding.substring(numMatch.index + numMatch[0].length).trim();
        } else {
            statement = statement.replace(/^(?:QUESTÃO\s*\d{1,2}|\d{1,2}\s*[\.\)-]?\s*)/i, '').trim();
        }

        // Se encontrou um texto de leitura extenso (>120 caracteres) antes da questão
        if (supportBeforeThis.length > 120 && !isInstructionBlock(supportBeforeThis)) {
            mainReadingText = supportBeforeThis;
        }

        statement = cleanGarbage(statement);

        let optA = cleanGarbage(clean.substring(block.aMatch.index + block.aMatch.length, block.bMatch.index));
        let optB = cleanGarbage(clean.substring(block.bMatch.index + block.bMatch.length, block.cMatch.index));
        let optC = cleanGarbage(clean.substring(block.cMatch.index + block.cMatch.length, block.dMatch.index));
        let optD = cleanGarbage(clean.substring(block.dMatch.index + block.dMatch.length, block.eMatch.index));
        let optE = cleanGarbage(clean.substring(block.eMatch.index + block.eMatch.length, block.endOfE));

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
    });

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

    // Cria/localiza o container de Texto de Apoio
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
        
        // Insere no topo do cartão da questão (acima do cabeçalho flex)
        const qTextEl = document.getElementById('q-text');
        if (qTextEl) {
            const parentCard = qTextEl.closest('.card-questao') || qTextEl.parentElement.parentElement || qTextEl.parentElement;
            parentCard.insertBefore(supportContainer, parentCard.firstChild);
        }
    }

    // Exibe o texto de referência apenas se ele existir
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
