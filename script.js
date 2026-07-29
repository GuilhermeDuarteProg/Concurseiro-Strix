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

    statusMsg.textContent = 'Extraindo e organizando as questões do PDF... Aguarde.';

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

// CORRIGE PALAVRAS CORTADAS COM HÍFEN
function fixHyphenatedWords(text) {
    if (!text) return '';
    return text.replace(/([a-zA-Z\u00C0-\u00FF]+)\s*-\s*([a-zA-Z\u00C0-\u00FF]+)/g, '$1$2');
}

// LIMPEZA SEGURA DE CABEÇALHOS E MARCAS D'ÁGUA
function cleanGarbage(text) {
    if (!text) return '';
    let clean = text;

    clean = clean.replace(/pcimarkpci\s*[A-Za-z0-9+/=]*/gi, '');
    clean = clean.replace(/[A-Za-z0-9+/=]{20,}==?/g, '');
    clean = clean.replace(/www\.pciconcursos\.com\.br\s*(?:PROVA)?/gi, '');
    clean = clean.replace(/RACIOCÍNIO\s+LÓGICO(?:\s+MATEMÁTICO)?/gi, '');
    clean = clean.replace(/RASCUNHO/gi, '');

    clean = clean.replace(/[ \t]+/g, ' ').trim();
    return fixHyphenatedWords(clean);
}

// EXTRAÇÃO POR COLUNAS E LINHAS DO PDF
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

// BUSCA MARCADOR EXATO DA PRÓXIMA QUESTÃO
function findNextQuestionMarker(text, expectedNum) {
    if (!text) return null;
    const padded = String(expectedNum).padStart(2, '0');
    const numStr = String(expectedNum);

    const regex = new RegExp(
        `(?:\\bQUESTÃO\\s*(?:${numStr}|${padded})\\b|\\b(?:${numStr}|${padded})\\s*[\\.\\)\\-]\\s*|\\b(?:${numStr}|${padded})\\s+(?=[A-Z\\u00C0-\\u00DC]))`,
        'i'
    );
    return regex.exec(text);
}

// PARSER ROBUTO DE QUESTÕES
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

    if (blocks.length === 0) return [];

    let currentSupportText = '';

    const parsedBlocks = blocks.map((block, idx) => ({
        block: block,
        number: idx + 1,
        statement: '',
        supportText: '',
        optA: '', optB: '', optC: '', optD: '', optE: ''
    }));

    // Processa o texto antes da Primeira Questão
    const textBeforeFirst = clean.substring(0, blocks[0].aMatch.index);
    const firstQMatch = textBeforeFirst.match(/(?:\bQUESTÃO\s*(\d{1,2})\b|\b(\d{1,2})\s*[\.\)\-]\s+|\b(\d{1,2})\s+(?=[A-Z\u00C0-\u00DC]))/i);

    if (firstQMatch) {
        const qNum = parseInt(firstQMatch[1] || firstQMatch[2] || firstQMatch[3], 10);
        parsedBlocks[0].number = qNum;
        
        const supportCandidate = textBeforeFirst.substring(0, firstQMatch.index).trim();
        if (supportCandidate.length > 80 && !isInstructionBlock(supportCandidate)) {
            parsedBlocks[0].supportText = cleanGarbage(supportCandidate);
        }
        parsedBlocks[0].statement = textBeforeFirst.substring(firstQMatch.index + firstQMatch[0].length).trim();
    } else {
        parsedBlocks[0].statement = textBeforeFirst.replace(/^(?:QUESTÃO\s*\d{1,2}|\d{1,2}\s*[\.\)-]?\s*)/i, '').trim();
    }

    // Processa cada questão e separa corretamente a alternativa E de textos de apoio / matérias
    for (let i = 0; i < blocks.length; i++) {
        const curr = parsedBlocks[i];
        const block = curr.block;

        curr.optA = cleanGarbage(clean.substring(block.aMatch.index + block.aMatch.length, block.bMatch.index));
        curr.optB = cleanGarbage(clean.substring(block.bMatch.index + block.bMatch.length, block.cMatch.index));
        curr.optC = cleanGarbage(clean.substring(block.cMatch.index + block.cMatch.length, block.dMatch.index));
        curr.optD = cleanGarbage(clean.substring(block.dMatch.index + block.dMatch.length, block.eMatch.index));

        const eStart = block.eMatch.index + block.eMatch.length;

        if (i < blocks.length - 1) {
            const nextAIndex = blocks[i + 1].aMatch.index;
            const subText = clean.substring(eStart, nextAIndex);
            const expectedNextNum = curr.number + 1;

            // Expressão para identificar onde a alternativa E termina e começa um cabeçalho / texto de leitura
            const headerRegex = /(?:\bPROVA\s+\d*|\bLÍNGUA\s+(?:INGLESA|PORTUGUESA)|\bCONHECIMENTOS\s+(?:ESPECÍFICOS|BÁSICOS|GERAIS)|\bTEXTO\s+(?:[I|V|X\d]+|\b)|\bLEIA\s+O\s+TEXTO|\bREAD\s+THE\s+TEXT|\bAS\s+QUESTÕES\b|\bQUESTIONS\b)/i;
            const headerMatch = subText.match(headerRegex);

            let qNextMatch = findNextQuestionMarker(subText, expectedNextNum);
            if (!qNextMatch) {
                qNextMatch = subText.match(/(?:\bQUESTÃO\s*(\d{1,2})\b|\b(\d{1,2})\s*[\.\)\-]\s+|\b(\d{1,2})\s+(?=[A-Z\u00C0-\u00DC]))/i);
            }

            let optEText = '';
            let remainderText = '';

            if (headerMatch && (!qNextMatch || headerMatch.index < qNextMatch.index)) {
                optEText = subText.substring(0, headerMatch.index);
                remainderText = subText.substring(headerMatch.index);
            } else if (qNextMatch) {
                optEText = subText.substring(0, qNextMatch.index);
                remainderText = subText.substring(qNextMatch.index);
            } else {
                optEText = subText;
                remainderText = '';
            }

            curr.optE = cleanGarbage(optEText);

            if (remainderText) {
                let qInRemainder = findNextQuestionMarker(remainderText, expectedNextNum);
                if (!qInRemainder) {
                    qInRemainder = remainderText.match(/(?:\bQUESTÃO\s*(\d{1,2})\b|\b(\d{1,2})\s*[\.\)\-]\s+|\b(\d{1,2})\s+(?=[A-Z\u00C0-\u00DC]))/i);
                }

                if (qInRemainder) {
                    let detectedNum = expectedNextNum;
                    if (qInRemainder[1] || qInRemainder[2] || qInRemainder[3]) {
                        detectedNum = parseInt(qInRemainder[1] || qInRemainder[2] || qInRemainder[3], 10);
                    }
                    parsedBlocks[i + 1].number = detectedNum;

                    const rawSupport = remainderText.substring(0, qInRemainder.index).trim();
                    if (rawSupport.length > 40 && !isInstructionBlock(rawSupport)) {
                        parsedBlocks[i + 1].supportText = cleanGarbage(rawSupport);
                    }

                    parsedBlocks[i + 1].statement = remainderText.substring(qInRemainder.index + qInRemainder[0].length).trim();
                } else {
                    parsedBlocks[i + 1].statement = remainderText.trim();
                }
            }
        } else {
            let endText = clean.length;
            const subText = clean.substring(eStart);
            const gabMatch = subText.search(/(?:GABARITO|PROVA\s+CONCLUÍDA|PCI\s*CONCURSOS)/i);
            if (gabMatch !== -1) endText = eStart + gabMatch;
            curr.optE = cleanGarbage(clean.substring(eStart, endText));
        }

        if (curr.supportText) {
            currentSupportText = curr.supportText;
        }

        curr.statement = cleanGarbage(curr.statement);

        const isInstruction = isInstructionBlock(curr.statement) ||
                              isInstructionBlock(curr.optA) ||
                              isInstructionBlock(curr.optB) ||
                              isInstructionBlock(curr.optC) ||
                              isInstructionBlock(curr.optD) ||
                              isInstructionBlock(curr.optE);

        if (!isInstruction && curr.statement.length > 2 && curr.optA && curr.optB && curr.optC && curr.optD && curr.optE) {
            extracted.push({
                number: curr.number,
                text: curr.statement,
                supportText: currentSupportText,
                options: {
                    A: curr.optA,
                    B: curr.optB,
                    C: curr.optC,
                    D: curr.optD,
                    E: curr.optE
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

    const displayNum = q.number ? q.number : (currentQuestionIndex + 1);
    document.getElementById('q-number').textContent = String(displayNum).padStart(2, '0');
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
