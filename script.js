document.addEventListener('DOMContentLoaded', () => {
  loadStudyPlan();
});

function switchTab(tabId, event) {
  if (event) {
    event.preventDefault();
  }

  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  document.querySelectorAll('nav a').forEach(link => {
    link.classList.remove('active');
  });

  const targetTab = document.getElementById(tabId);
  if (targetTab) {
    targetTab.classList.add('active');
  }

  const targetBtn = document.querySelector(`nav a[href="#${tabId}"]`);
  if (targetBtn) {
    targetBtn.classList.add('active');
  }
}

function openLoginModal() {
  document.getElementById('login-modal').classList.add('active');
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('active');
}

function toggleAuthMode(mode) {
  const loginForm = document.getElementById('login-form-container');
  const registerForm = document.getElementById('register-form-container');

  if (mode === 'register') {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
  } else {
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
  }
}

function togglePasswordVisibility(inputId, iconId) {
  const passwordInput = document.getElementById(inputId);
  const eyeIcon = document.getElementById(iconId);

  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    eyeIcon.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    `;
  } else {
    passwordInput.type = 'password';
    eyeIcon.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `;
  }
}

function handleAuth(event, type) {
  event.preventDefault();
  if (type === 'register') {
    alert('Cadastro realizado com sucesso!');
  } else {
    alert('Login efetuado com sucesso!');
  }
  closeLoginModal();
}

// Salva o plano de estudos no localStorage
function saveStudyPlan(event) {
  event.preventDefault();

  const plan = {
    targetExam: document.getElementById('target-exam').value,
    studyArea: document.getElementById('study-area').value,
    dailyQuestions: document.getElementById('daily-questions').value,
    dailyHours: document.getElementById('daily-hours').value,
    studyPlanText: document.getElementById('study-plan-text').value,
  };

  localStorage.setItem('strix_study_plan', JSON.stringify(plan));
  renderStudyPlan(plan);
  alert('Plano de estudos salvo com sucesso!');
}

// Carrega o plano de estudos gravado
function loadStudyPlan() {
  const savedPlan = localStorage.getItem('strix_study_plan');
  if (savedPlan) {
    const plan = JSON.parse(savedPlan);
    document.getElementById('target-exam').value = plan.targetExam || '';
    document.getElementById('study-area').value = plan.studyArea || '';
    document.getElementById('daily-questions').value = plan.dailyQuestions || '';
    document.getElementById('daily-hours').value = plan.dailyHours || '';
    document.getElementById('study-plan-text').value = plan.studyPlanText || '';
    renderStudyPlan(plan);
  }
}

// Atualiza o painel superior com os dados gravados
function renderStudyPlan(plan) {
  if (plan.dailyQuestions) {
    document.getElementById('disp-meta-questoes').textContent = plan.dailyQuestions;
  }
  if (plan.dailyHours) {
    document.getElementById('disp-meta-horas').textContent = `${plan.dailyHours}h`;
  }
  if (plan.targetExam) {
    document.getElementById('disp-concurso').textContent = plan.targetExam;
  }
}// Configuração do Worker do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

async function processPDFToJSON() {
  const fileInput = document.getElementById('pdf-file-input');
  if (!fileInput.files.length) {
    alert('Por favor, selecione um arquivo PDF.');
    return;
  }

  const file = fileInput.files[0];
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullExtractedText = "";

  // Começa da página 2 para ignorar a capa/instruções
  for (let pageNum = 2; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    
    const pageMiddleX = viewport.width / 2;

    let leftColumnItems = [];
    let rightColumnItems = [];

    // Separa os elementos de texto por coordenada X (Duas Colunas)
    textContent.items.forEach(item => {
      if (item.str.trim() === '') return;

      const [scaleX, skewX, skewY, scaleY, x, y] = item.transform;
      
      if (x < pageMiddleX) {
        leftColumnItems.push({ text: item.str, x, y });
      } else {
        rightColumnItems.push({ text: item.str, x, y });
      }
    });

    // Ordena de cima para baixo (maior Y para menor Y)
    const sortByY = (a, b) => b.y - a.y;
    leftColumnItems.sort(sortByY);
    rightColumnItems.sort(sortByY);

    // Junta o texto respeitando as colunas
    const leftText = leftColumnItems.map(i => i.text).join(' ');
    const rightText = rightColumnItems.map(i => i.text).join(' ');

    fullExtractedText += leftText + " " + rightText + " ";
  }

  // 1. Correção de Hifenização no final das linhas
  // Transforma "cons- \n tituição" ou "cons- tituição" em "constituição"
  let cleanText = fullExtractedText.replace(/(\w+)-\s+(\w+)/g, '$1$2');

  // 2. Normalização de espaços múltiplos
  cleanText = cleanText.replace(/\s+/g, ' ');

  // 3. Estruturação do JSON dividindo por padrão "QUESTÃO X"
  const questionsRaw = cleanText.split(/(?=QUESTÃO\s+\d+|QUESTAO\s+\d+)/gi);
  
  const parsedQuestions = questionsRaw
    .filter(q => q.trim().length > 10)
    .map((qText, index) => {
      return {
        id: index + 1,
        raw_content: qText.trim()
      };
    });

  // Exibe o JSON gerado
  const jsonOutput = JSON.stringify(parsedQuestions, null, 2);
  document.getElementById('json-output').value = jsonOutput;
  document.getElementById('json-result-card').style.display = 'block';
}

function downloadJSON() {
  const content = document.getElementById('json-output').value;
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'questoes_concurso.json';
  a.click();
}// Carrega o catálogo assim que o site abre
document.addEventListener('DOMContentLoaded', () => {
  carregarCatalogoProvas();
});

// Lê o arquivo provas/index.json
async function carregarCatalogoProvas() {
  const selectProvas = document.getElementById('select-prova');
  if (!selectProvas) return;

  try {
    const response = await fetch('provas/index.json');
    if (!response.ok) throw new Error('Não foi possível ler o index.json');

    const provas = await response.json();
    
    // Limpa as opções padrão
    selectProvas.innerHTML = '<option value="">Selecione uma prova disponível...</option>';

    // Preenche com as provas cadastradas
    provas.forEach(prova => {
      const option = document.createElement('option');
      option.value = prova.arquivo;
      option.textContent = `${prova.orgao} (${prova.ano}) - ${prova.titulo} [${prova.banca}]`;
      selectProvas.appendChild(option);
    });
  } catch (erro) {
    console.error('Erro ao carregar catálogo de provas:', erro);
    selectProvas.innerHTML = '<option value="">Erro ao carregar provas</option>';
  }
}