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

    statusMsg.textContent = 'Eliminando capa de instruções e organizando as questões... Aguarde.';

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

// REMOVE A CAPA DE INSTRUÇÕES DA BANCA (Ex: "O candidato recebeu do fiscal...", "LEIA COM ATENÇÃO")
function removeCoverPage(text) {
    if (!text) return '';

    // Procura o início real da prova (Ex: LÍNGUA PORTUGUESA, CONHECIMENTOS BÁSICOS/ESPECÍFICOS ou TEXTO I)
    const realStartMatch = text.search(/(?:LÍNGUA\s+PORTUGUESA|CONHECIMENTOS\s+(?:BÁSICOS|ESPECÍFICOS|GERAIS)|TEXTO\s+[I1V])/i);

    if (realStartMatch !== -1 && realStartMatch < 3500) {
        return text.substring(realStartMatch);
    }

    // Caso não encontre cabeçalhos padrão, remove trechos com regras de fiscal/eliminação
    let clean = text.replace(/LEIA\s+ATENTAMENTE\s+AS\s+INSTRUÇÕES[\s\S]*?(?=LÍNGUA|CONHECIMENTOS|TEXTO|QUESTÃO\s+0?1\b)/gi, '');
    clean = clean.replace(/O\s+candidato\s+recebeu\s+do\s+fiscal[\s\S]*?(?=LÍNGUA|CONHECIMENTOS|TEXTO|QUESTÃO\s+0?1\b)/gi, '');

    return clean;
}

// CORRIGE PALAVRAS CORTADAS COM HÍFEN (Ex: "gru - pos" -> "grupos")
function fixHyphenatedWords(text) {
    if (!text) return '';
    return text.replace(/([a-zA-Z\u00C0-\u00FF]+)\s*-\s*([a-zA-Z\u00C0-\u00FF]+)/g, '$1$2');
}

// LIMPEZA RIGOROSA DE MARCAS D'ÁGUA E CABEÇALHOS
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
    clean = clean.replace(/How space technology is bringing green wins for transport/gi, '');

    clean = clean.replace(/\s+/g, ' ').trim();
    return fixHyphenatedWords(clean);
}

// LEITURA POR COLUNAS E LINHAS
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

// EXTRAÇÃO DE QUESTÕES SEM A CAPA DE INSTRUÇÕES
function parseExamQuestions(rawText) {
    const withoutCover = removeCoverPage(rawText);
    const clean = cleanGarbage(withoutCover);
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
                let rawPrecedingText = clean.substring(0, aMatch.index).trim();

                // Procura a numeração da questão no texto anterior
                const qMatches = [...rawPrecedingText.matchAll(/(?:\bQUESTÃO\s+(\d{1,2})\b|\b(\d{1,2})\s*[\.\)-]?\s+[A-Z\u00C0-\u00DC])/gi)];

                let questionStatement = rawPrecedingText;
                if (qMatches.length > 0) {
                    const lastQ = qMatches[qMatches.length - 1];
                    questionStatement = rawPrecedingText.substring(lastQ.index).trim();
                }

                questionStatement = questionStatement.replace(/^(QUESTÃO\s+\d{1,2}|\d{1,2}\s*[\.\)-]?\s*)/i, '').trim();
                questionStatement = cleanGarbage(questionStatement);

                let optA = cleanGarbage(clean.substring(aMatch.index + aMatch.length, bMatch.index));
                let optB = cleanGarbage(clean.substring(bMatch.index + bMatch.length, cMatch.index));
                let optC = cleanGarbage(clean.substring(cMatch.index + cMatch.length, dMatch.index));
                let optD = cleanGarbage(clean.substring(dMatch.index + dMatch.length, eMatch.index));

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

                let optE = cleanGarbage(clean.substring(eMatch.index + eMatch.length, endOfE));

                // Descarta se for texto de regra do fiscal
                if (questionStatement.includes("O candidato recebeu do fiscal") || questionStatement.includes("CARTÃO-RESPOSTA")) {
                    continue;
                }

                if (questionStatement.length > 3 && optA && optB && optC && optD && optE) {
                    extracted.push({
                        text: questionStatement,
                        options: {
                            A: optA,
                            B: optB,
                            C: optC,
                            D: optD,
                            E: optE
                        }
                    });
                }

                i = matches.indexOf(eMatch);
            }
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
