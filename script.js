// Estado global da aplicação
let questionsData = [];
let currentQuestionIndex = 0;
let userAnswers = {};

// Função auxiliar para limpeza de ruídos no texto
function cleanGarbage(text) {
    if (!text) return '';
    return text
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();
}

// Escapa HTML para prevenir problemas de renderização
function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
}

// Extrai opções (A, B, C, D, E) e o enunciado de uma fatia de texto
function extractOptionsFromSlice(slice) {
    const optRegex = /(?:^|\n|\s+)(?:\(([A-E])\)|([A-E])[\.\)\-])\s+/g;
    
    const matches = [];
    let m;
    while ((m = optRegex.exec(slice)) !== null) {
        const letter = (m[1] || m[2]).toUpperCase();
        matches.push({
            letter: letter,
            index: m.index,
            matchLength: m[0].length
        });
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
        
        // Isola e corta a Opção E para não invadir a questão seguinte
        let endEOffset = restE.search(/(?:\n\s*\n|\n?\s*(?:QUESTÃO|\d{1,2}\s*[\.\)\-])|\n?\s*CONHECIMENTOS)/i);
        if (endEOffset === -1 || endEOffset > 300) {
            endEOffset = Math.min(restE.length, 250);
        }
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

// Analisa e estrutura o texto da prova
function parseExamQuestions(rawText) {
    const cleanText = cleanGarbage(rawText);
    const extracted = [];

    // Busca apenas por números de questões estruturados no início de linha
    const qHeaderRegex = /(?:^|\n)\s*(?:QUESTÃO\s+)?(\d{1,2})\s*[\.\)\-]\s+/gi;
    let match;
    const candidates = [];

    while ((match = qHeaderRegex.exec(cleanText)) !== null) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 120) {
            candidates.push({
                number: num,
                index: match.index,
                contentIndex: match.index + match[0].length
            });
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

            // Extrai o texto de apoio apenas quando ele surge antes das questões
            const textHeaderMatch = statement.match(/(?:\bTEXTO\s+[I|V|X\d]*|\bREAD\s+THE\s+TEXT|\bLEIA\s+O\s+TEXTO)/i);
            if (textHeaderMatch) {
                const headerIdx = textHeaderMatch.index;
                activeSupportText = statement.substring(headerIdx).trim();
                statement = statement.substring(0, headerIdx).trim();
            }

            extracted.push({
                number: cand.number,
                text: statement || `Questão ${cand.number}`,
                supportText: activeSupportText, 
                options: parsed.options
            });
        }
    }

    // Filtra duplicatas mantendo apenas a primeira leitura válida de cada questão
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

// Renderiza a questão atual na tela
function renderQuestion(index) {
    if (!questionsData || questionsData.length === 0 || !questionsData[index]) return;

    const q = questionsData[index];

    // 1. Atualizar Número da Questão
    const qNumEl = document.getElementById('questionNumber');
    if (qNumEl) qNumEl.innerText = `Questão ${q.number}`;

    // 2. Tratar Texto de Apoio (Caixa Retrátil)
    const supportContainer = document.getElementById('supportContainer');
    if (supportContainer) {
        // Exibe o texto de apoio apenas se ele existir e for relevante (ex: questões de interpretação 1 a 10)
        if (q.supportText && q.supportText.trim() !== '' && q.number <= 10) {
            supportContainer.innerHTML = `
                <details class="support-box" open>
                    <summary>📖 Texto de Referência (Clique para expandir/recolher)</summary>
                    <div class="support-content">${escapeHtml(q.supportText)}</div>
                </details>
            `;
            supportContainer.style.display = 'block';
        } else {
            supportContainer.innerHTML = '';
            supportContainer.style.display = 'none';
        }
    }

    // 3. Atualizar Enunciado
    const qTextEl = document.getElementById('questionText');
    if (qTextEl) qTextEl.innerText = q.text;

    // 4. Renderizar Opções (A, B, C, D, E)
    const optionsListEl = document.getElementById('optionsList');
    if (optionsListEl) {
        optionsListEl.innerHTML = '';
        const selectedOpt = userAnswers[q.number];

        ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
            if (q.options && q.options[letter]) {
                const isSelected = selectedOpt === letter;
                const optDiv = document.createElement('div');
                optDiv.className = `option-item ${isSelected ? 'selected' : ''}`;
                optDiv.onclick = () => selectOption(q.number, letter);

                optDiv.innerHTML = `
                    <span class="option-letter">${letter})</span>
                    <span class="option-text">${escapeHtml(q.options[letter])}</span>
                `;
                optionsListEl.appendChild(optDiv);
            }
        });
    }

    // 5. Atualizar Estados dos Botões de Navegação
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.disabled = (index === 0);
    if (nextBtn) nextBtn.disabled = (index === questionsData.length - 1);
}

// Selecionar uma opção
function selectOption(questionNum, letter) {
    userAnswers[questionNum] = letter;
    renderQuestion(currentQuestionIndex);
}

// Funções de navegação
function nextQuestion() {
    if (currentQuestionIndex < questionsData.length - 1) {
        currentQuestionIndex++;
        renderQuestion(currentQuestionIndex);
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderQuestion(currentQuestionIndex);
    }
}

// Inicialização com o texto extraído do PDF
function loadParsedText(rawPdfText) {
    questionsData = parseExamQuestions(rawPdfText);
    currentQuestionIndex = 0;
    userAnswers = {};
    if (questionsData.length > 0) {
        renderQuestion(0);
    }
}
