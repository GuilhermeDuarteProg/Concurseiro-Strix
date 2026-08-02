// Dados demonstrativos de teste
const mockQuestions = [
  {
    number: 1,
    supportText: "O texto a seguir serve de base para a questão.\nA transformação digital no setor público vem acelerando os processos administrativos através do uso de IA e automações...",
    text: "Com base no texto de referência, assinale a alternativa que indica a principal vantagem da transformação digital:",
    options: {
      A: "Aumento de custos com infraestrutura física.",
      B: "Otimização de processos e resposta mais rápida ao cidadão.",
      C: "Substituição total de todos os servidores públicos por robôs.",
      D: "Redução no nível de transparência das decisões.",
      E: "Eliminação da necessidade de segurança da informação."
    }
  },
  {
    number: 2,
    supportText: "",
    text: "De acordo com a Lei de Acesso à Informação, os órgãos públicos devem garantir a transparência passiva e ativa. Assinale a opção correta:",
    options: {
      A: "A informação pessoal tem acesso irrestrito a qualquer cidadão.",
      B: "O cidadão precisa justificar o motivo da solicitação de informação pública.",
      C: "A divulgação de informações de interesse público independe de solicitações na transparência ativa.",
      D: "Informações classificadas como ultra-secretas têm prazo de sigilo de 10 anos.",
      E: "Não há canal digital obrigatório para pedidos de acesso."
    }
  }
];

let currentIndex = 0;
let selectedAnswers = {};

// Elementos da DOM
const setupScreen = document.getElementById('setupScreen');
const quizScreen = document.getElementById('quizScreen');
const startBtn = document.getElementById('startBtn');

const questionCounter = document.getElementById('questionCounter');
const totalCounter = document.getElementById('totalCounter');
const supportContainer = document.getElementById('supportContainer');
const supportText = document.getElementById('supportText');
const questionText = document.getElementById('questionText');
const optionsList = document.getElementById('optionsList');

const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

// Alternar para a tela do simulado
startBtn.addEventListener('click', () => {
  setupScreen.classList.add('hidden');
  quizScreen.classList.remove('hidden');
  renderQuestion(0);
});

// Renderizar a questão atual
function renderQuestion(index) {
  const q = mockQuestions[index];
  
  questionCounter.textContent = `Questão ${q.number}`;
  totalCounter.textContent = `${index + 1} de ${mockQuestions.length}`;
  questionText.textContent = q.text;

  // Texto de apoio
  if (q.supportText && q.supportText.trim() !== '') {
    supportText.textContent = q.supportText;
    supportContainer.style.display = 'block';
  } else {
    supportContainer.style.display = 'none';
  }

  // Alternativas
  optionsList.innerHTML = '';
  Object.keys(q.options).forEach(letter => {
    const isSelected = selectedAnswers[q.number] === letter;
    
    const optDiv = document.createElement('div');
    optDiv.className = `option-item ${isSelected ? 'selected' : ''}`;
    optDiv.onclick = () => selectOption(q.number, letter);

    optDiv.innerHTML = `
      <span class="option-letter">${letter})</span>
      <span class="option-text">${q.options[letter]}</span>
    `;

    optionsList.appendChild(optDiv);
  });

  // Atualizar botões de navegação
  prevBtn.disabled = index === 0;
  nextBtn.textContent = index === mockQuestions.length - 1 ? 'Finalizar' : 'Próxima →';
}

function selectOption(qNum, letter) {
  selectedAnswers[qNum] = letter;
  renderQuestion(currentIndex);
}

prevBtn.addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion(currentIndex);
  }
});

nextBtn.addEventListener('click', () => {
  if (currentIndex < mockQuestions.length - 1) {
    currentIndex++;
    renderQuestion(currentIndex);
  } else {
    alert('Simulado finalizado! Veja seu gabarito.');
  }
});
