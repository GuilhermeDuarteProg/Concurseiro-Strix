// Configuração do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let questions = [];
let currentQuestionIndex = 0;
let userAnswers = {};
let timerInterval;
let secondsElapsed = 0;

// Elementos da DOM
const fileInput = document.getElementById('pdf-file-input');
const dropZone = document.getElementById('drop-zone');
const statusMessage = document.getElementById('status-message');

const uploadSection = document.getElementById('upload-section');
const quizSection = document.getElementById('quiz-section');
const resultSection = document.getElementById('result-section');

// Configuração do Drag and Drop
if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });
}

// Processa o arquivo PDF
async function handleFile(file) {
    if (file.type !== 'application/pdf') {
        statusMessage.textContent = 'Por favor, envie um arquivo PDF válido.';
        return;
    }

    statusMessage.textContent = 'Lendo e extraindo questões do PDF...';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }

        questions = parseQuestionsFromText(fullText);

        if (questions.length === 0) {
            statusMessage.textContent = 'Não foi possível identificar questões com alternativas neste PDF.';
            return;
        }

        startQuiz();

    } catch (error) {
        console.error(error);
        statusMessage.textContent = 'Erro ao processar o arquivo PDF.';
    }
}

// Algoritmo MELHORADO para separar Questões e Alternativas (A, B, C, D, E)
function parseQuestionsFromText(text) {
    const extractedQuestions = [];

    // 1. Limpeza de sujeiras do PDF (código 'pcimarkpci' e marcas d'água)
    let cleanText = text.replace(/pcimarkpci\s*[A-Za-z0-9+/=]*==/g, ''); 
    cleanText = cleanText.replace(/\s+/g, ' ');

    // 2. Pula instruções e cabeçalhos desnecessários do início da prova
    const startPos = cleanText.search(/(?:PROVA|LÍNGUA PORTUGUESA|CONHECIMENTOS|QUESTÃO\s+0?1)/i);
    if (startPos !== -1 && startPos < 2000) {
        cleanText = cleanText.substring(startPos);
    }

    // 3. Separa os blocos de questões (procura por 1., 01), Questão 1, etc.)
    const questionBlocks = cleanText.split(/(?=(?:Questão\s+\d+|\b\d{1,2}[\.\)]\s+))/i);

    questionBlocks.forEach((block) => {
        // Captura alternativas A), B), C), D), E)
        const optionMatches = [...block.matchAll(/(?:^|\s)([A-E])[\.\)]\s*(.*?)(?=(?:\s[A-E][\.\)]|$))/gi)];

        if (optionMatches.length >= 4) {
            const options = {};
            optionMatches.forEach(match => {
                const letter = match[1].toUpperCase();
                const optionText = match[2].trim();
                options[letter] = optionText;
            });

            // Extrai o enunciado da questão
            const firstOptionIndex = block.search(/(?:^|\s)[A-E][\.\)]/i);
            let questionText = firstOptionIndex !== -1 ? block.substring(0, firstOptionIndex).trim() : block;
            
            // Remove numeração do início do enunciado
            questionText = questionText.replace(/^(Questão\s+\d+|\d{1,2}[\.\)]\s*)/i, '').trim();

            if (questionText.length > 5) {
                extractedQuestions.push({
                    text: questionText,
                    options: options
                });
            }
        }
    });

    return extractedQuestions;
}

// Inicia o Simulado
function startQuiz() {
    uploadSection.style.display = 'none';
    quizSection.style.display = 'block';
    
    currentQuestionIndex = 0;
    userAnswers = {};
    secondsElapsed = 0;

    startTimer();
    renderQuestion();
}

// Renderiza a questão
function renderQuestion() {
    const q = questions[currentQuestionIndex];
    
    document.getElementById('q-number').textContent = String(currentQuestionIndex + 1).padStart(2, '0');
    document.getElementById('q-text').textContent = q.text;

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    const letters = ['A', 'B', 'C', 'D', 'E'];

    letters.forEach(letter => {
        if (q.options[letter]) {
            const button = document.createElement('button');
            button.className = 'option-btn';
            if (userAnswers[currentQuestionIndex] === letter) {
                button.classList.add('selected');
            }

            button.innerHTML = `
                <span class="badge">${letter}</span>
                <span class="text">${q.options[letter]}</span>
            `;

            button.onclick = () => selectAnswer(letter);
            optionsContainer.appendChild(button);
        }
    });

    // Navegação
    document.getElementById('btn-prev').style.display = currentQuestionIndex === 0 ? 'none' : 'inline-block';
    
    if (currentQuestionIndex === questions.length - 1) {
        document.getElementById('btn-next').style.display = 'none';
        document.getElementById('btn-finish').style.display = 'inline-block';
    } else {
        document.getElementById('btn-next').style.display = 'inline-block';
        document.getElementById('btn-finish').style.display = 'none';
    }
}

function selectAnswer(letter) {
    userAnswers[currentQuestionIndex] = letter;
    renderQuestion();
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
    quizSection.style.display = 'none';
    resultSection.style.display = 'block';

    const answeredCount = Object.keys(userAnswers).length;
    document.getElementById('total-answered').textContent = answeredCount;
    document.getElementById('total-questions').textContent = questions.length;
}
