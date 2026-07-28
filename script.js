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

    statusMsg.textContent = 'Lendo e organizando as colunas da prova... Aguarde.';

    try {
        const examText = await extractTextFromPDF(examFile);
        questions = parseExamQuestions(examText);

        if (questions.length === 0) {
            statusMsg.textContent = 'Não foi possível extrair as questões do PDF.';
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

// LEITOR POR COLUNAS (Resolve o problema de misturar lado esquerdo e direito)
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

            // Separa os elementos da esquerda e da direita
            if (x < midX) {
                leftCol.push({ str: item.str, y, x });
            } else {
                rightCol.push({ str: item.str, y, x });
            }
        });

        // Ordena de cima para baixo (coordenada Y decrescente no PDF)
        leftCol.sort((a, b) => b.y - a.y || a.x - b.x);
        rightCol.sort((a, b) => b.y - a.y || a.x - b.x);

        const leftText = leftCol.map(item => item.str).join(' ');
        const rightText = rightCol.map(item => item.str).join(' ');

        fullText += leftText + '\n' + rightText + '\n';
    }

    return fullText;
}

// PARSER INTELIGENTE COM REMOÇÃO DE SUJEIRA
function parseExamQuestions(text) {
    const extracted = [];

    let clean = text;

    // 1. Remove marcas d'água PCI Concursos e strings Base64
    clean = clean.replace(/1\s*2\s*3\s*4\s*5\s*6\s*7\s*8\s*9\s*[A-Za-z0-9+/=]*==?\s*www\.pciconcursos\.com\.br\s*PROVA/gi, '');
    clean = clean.replace(/pcimarkpci\s*[A-Za-z0-9+/=]*==?/gi, '');
    clean = clean.replace(/pcimarkpci/gi, '');
    clean = clean.replace(/[A-Za-z0-9+/=]{30,}==?/g, '');
    clean = clean.replace(/www\.pciconcursos\.com\.br\s*PROVA/gi, '');

    // 2. Remove cabeçalhos e rodapés da Transpetro/Cesgranrio
    clean = clean.replace(/ADMINISTRAÇÃO\s+\d+\s+TERRA\s+TRANSPETRO\s*(?:RASCUNHO\s+\d+)?/gi, '');
    clean = clean.replace(/CONHECIMENTOS\s+ESPECÍFICOS\s+\d+/gi, '');
    clean = clean.replace(/RASCUNHO\s+\d+/gi, '');
    clean = clean.replace(/\s+/g, ' ');

    // 3. Separa pelos números de questão (Ex: "QUESTÃO 1", "01 ", "1 .")
    const blocks = clean.split(/(?=(?:\bQUESTÃO\s+\d{1,2}\b|\b\d{1,2}\s*[\.\)-]\s+[A-Z\u00C0-\u00FF]))/i);

    blocks.forEach((block) => {
        const lower = block.toLowerCase();

        // Descarta capas/instruções
        if (lower.includes('será eliminado') || lower.includes('leia atentamente') || lower.includes('folha de respostas')) {
            return;
        }

        // Procura alternativas de A a E
        const optionRegex = /(?:^|\s)[(\[]?([A-E])[)\.\-\]]\s+(.*?)(?=(?:\s+[(\[]?[A-E][)\.\-\]]\s+|$))/gi;
        const matches = [...block.matchAll(optionRegex)];

        if (matches.length >= 4) {
            const options = {};
            matches.forEach(m => {
                const letter = m[1].toUpperCase();
                let optText = m[2].trim();
                
                // Limpa sujeira final no texto das alternativas
                optText = optText.replace(/www\.pciconcursos\.com\.br.*/gi, '').trim();
                
                options[letter] = optText;
            });

            // Isola o enunciado do trecho antes das alternativas
            const firstOptIdx = block.search(/(?:^|\s)[(\[]?[A-E][)\.\-\]]\s+/i);
            let qText = firstOptIdx !== -1 ? block.substring(0, firstOptIdx).trim() : block;
            
            // Limpa numeração do topo do enunciado
            qText = qText.replace(/^(QUESTÃO\s+\d+|\d{1,2}\s*[\.\)-]\s*)/i, '').trim();

            if (qText.length > 5) {
                extracted.push({
                    text: qText,
                    options: options
                });
            }
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
