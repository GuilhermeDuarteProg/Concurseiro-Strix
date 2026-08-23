document.addEventListener('DOMContentLoaded', () => {
  loadStudyPlan();
  carregarCatalogoProvas();
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
  alert('Plano de estudos salvo com sucesso!');
}

function loadStudyPlan() {
  const savedPlan = localStorage.getItem('strix_study_plan');
  if (savedPlan) {
    const plan = JSON.parse(savedPlan);
    if (document.getElementById('target-exam')) document.getElementById('target-exam').value = plan.targetExam || '';
    if (document.getElementById('study-area')) document.getElementById('study-area').value = plan.studyArea || '';
    if (document.getElementById('daily-questions')) document.getElementById('daily-questions').value = plan.dailyQuestions || '';
    if (document.getElementById('daily-hours')) document.getElementById('daily-hours').value = plan.dailyHours || '';
    if (document.getElementById('study-plan-text')) document.getElementById('study-plan-text').value = plan.studyPlanText || '';
  }
}

// Configuração do Worker do PDF.js
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

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

  for (let pageNum = 2; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    
    const pageMiddleX = viewport.width / 2;

    let leftColumnItems = [];
    let rightColumnItems = [];

    textContent.items.forEach(item => {
      if (item.str.trim() === '') return;

      const [scaleX, skewX, skewY, scaleY, x, y] = item.transform;
      
      if (x < pageMiddleX) {
        leftColumnItems.push({ text: item.str, x, y });
      } else {
        rightColumnItems.push({ text: item.str, x, y });
      }
    });

    const sortByY = (a, b) => b.y - a.y;
    leftColumnItems.sort(sortByY);
    rightColumnItems.sort(sortByY);

    const leftText = leftColumnItems.map(i => i.text).join(' ');
    const rightText = rightColumnItems.map(i => i.text).join(' ');

    fullExtractedText += leftText + " " + rightText + " ";
  }

  let cleanText = fullExtractedText.replace(/(\w+)-\s+(\w+)/g, '$1$2');
  cleanText = cleanText.replace(/\s+/g, ' ');

  const questionsRaw = cleanText.split(/(?=QUESTÃO\s+\d+|QUESTAO\s+\d+)/gi);
  
  const parsedQuestions = questionsRaw
    .filter(q => q.trim().length > 10)
    .map((qText, index) => {
      return {
        id: index + 1,
        raw_content: qText.trim()
      };
    });

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
}

// Carrega o catálogo de provas
async function carregarCatalogoProvas() {
  const selectProvas = document.getElementById('select-prova');
  if (!selectProvas) return;

  try {
    const response = await fetch('provas/index.json');
    if (!response.ok) throw new Error('Não foi possível ler o index.json');

    const provas = await response.json();
    
    selectProvas.innerHTML = '<option value="">Selecione uma prova disponível...</option>';

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

// Renderiza o simulado na tela ao clicar
async function iniciarSimulado() {
  const selectProvas = document.getElementById('select-prova');
  const arquivoJson = selectProvas ? selectProvas.value : '';

  if (!arquivoJson) {
    alert('Por favor, selecione uma prova primeiro!');
    return;
  }

  const areaQuestoes = document.getElementById('area-questoes');
  if (!areaQuestoes) return;

  try {
    areaQuestoes.style.display = 'block';
    areaQuestoes.innerHTML = '<h3>Carregando questões do simulado...</h3>';

    const response = await fetch(arquivoJson);
    if (!response.ok) throw new Error('Não foi possível carregar as questões.');

    const dadosProva = await response.json();
    
    const questoes = dadosProva.questoes || (Array.isArray(dadosProva) ? dadosProva : []);

    if (questoes.length === 0) {
      areaQuestoes.innerHTML = '<p>Nenhuma questão encontrada para este simulado.</p>';
      return;
    }

    let htmlContent = `<h2>${dadosProva.concurso || 'Simulado'}</h2><hr style="margin-bottom: 1.5rem; border-color: rgba(255,255,255,0.1);">`;

    questoes.forEach((q, index) => {
      const num = q.numero || q.id || (index + 1);
      const disciplina = q.disciplina ? `<small style="color: var(--text-secondary);">${q.disciplina}</small><br>` : '';
      
      htmlContent += `
        <div style="margin-bottom: 2rem; padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px;">
          ${disciplina}
          <strong>Questão ${num}</strong>
          <p style="margin: 0.8rem 0;">${q.enunciado || q.texto || q.raw_content || ''}</p>
          <div class="alternativas-container">
      `;

      if (q.alternativas) {
        Object.entries(q.alternativas).forEach(([letra, textoAlt]) => {
          htmlContent += `
            <label class="opcao-resposta">
              <input type="radio" name="q_${num}" value="${letra}" onchange="destacarOpcao(this)">
              <strong>${letra})</strong> ${textoAlt}
            </label>
          `;
        });
      }

      htmlContent += `</div></div>`;
    });

    areaQuestoes.innerHTML = htmlContent;
  } catch (erro) {
    console.error('Erro ao iniciar simulado:', erro);
    areaQuestoes.innerHTML = '<p style="color: red;">Erro ao carregar o simulado. Verifique o arquivo JSON.</p>';
  }
}function destacarOpcao(inputRadio) {
  // Encontra o container pai da questão
  const container = inputRadio.closest('.alternativas-container');
  if (!container) return;

  // Remove a classe "selecionada" de todas as opções da mesma questão
  container.querySelectorAll('.opcao-resposta').forEach(label => {
    label.classList.remove('selecionada');
  });

  // Adiciona a classe no label selecionado
  const labelAtual = inputRadio.closest('.opcao-resposta');
  if (labelAtual) {
    labelAtual.classList.add('selecionada');
  }
}let questoesAtuais = [];

// Função que inicia e desenha o botão de finalizar
async function iniciarSimulado() {
  const selectProvas = document.getElementById('select-prova');
  const arquivoJson = selectProvas ? selectProvas.value : '';

  if (!arquivoJson) {
    alert('Por favor, selecione uma prova primeiro!');
    return;
  }

  const areaQuestoes = document.getElementById('area-questoes');
  if (!areaQuestoes) return;

  try {
    areaQuestoes.style.display = 'block';
    areaQuestoes.innerHTML = '<h3>Carregando questões do simulado...</h3>';

    const response = await fetch(arquivoJson);
    if (!response.ok) throw new Error('Não foi possível carregar as questões.');

    const dadosProva = await response.json();
    questoesAtuais = dadosProva.questoes || (Array.isArray(dadosProva) ? dadosProva : []);

    if (questoesAtuais.length === 0) {
      areaQuestoes.innerHTML = '<p>Nenhuma questão encontrada para este simulado.</p>';
      return;
    }

    let htmlContent = `<h2>${dadosProva.concurso || 'Simulado'}</h2><hr style="margin-bottom: 1.5rem; border-color: rgba(255,255,255,0.1);">`;

    questoesAtuais.forEach((q, index) => {
      const num = q.numero || q.id || (index + 1);
      const disciplina = q.disciplina ? `<small style="color: var(--text-secondary);">${q.disciplina}</small><br>` : '';
      
      htmlContent += `
        <div style="margin-bottom: 2rem; padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px;">
          ${disciplina}
          <strong>Questão ${num}</strong>
          <p style="margin: 0.8rem 0;">${q.enunciado || q.texto || q.raw_content || ''}</p>
          <div class="alternativas-container">
      `;

      if (q.alternativas) {
        Object.entries(q.alternativas).forEach(([letra, textoAlt]) => {
          htmlContent += `
            <label class="opcao-resposta">
              <input type="radio" name="q_${num}" value="${letra}" onchange="destacarOpcao(this)">
              <strong>${letra})</strong> ${textoAlt}
            </label>
          `;
        });
      }

      htmlContent += `</div></div>`;
    });

    // Botão de Finalizar no fim do simulado
    htmlContent += `
      <div style="text-align: center; margin-top: 2rem;">
        <button class="btn-primary" style="padding: 1rem 2.5rem; font-size: 1.1rem;" onclick="validarEFinalizarSimulado()">Finalizar Simulado</button>
      </div>
    `;

    areaQuestoes.innerHTML = htmlContent;
  } catch (erro) {
    console.error('Erro ao iniciar simulado:', erro);
    areaQuestoes.innerHTML = '<p style="color: red;">Erro ao carregar o simulado. Verifique o arquivo JSON.</p>';
  }
}

// Checa questões em branco antes de finalizar
function validarEFinalizarSimulado() {
  let respondidas = 0;
  let total = questoesAtuais.length;

  questoesAtuais.forEach((q, index) => {
    const num = q.numero || q.id || (index + 1);
    if (document.querySelector(`input[name="q_${num}"]:checked`)) {
      respondidas++;
    }
  });

  const emBranco = total - respondidas;

  if (emBranco > 0) {
    document.getElementById('confirm-modal-msg').innerText = `Você ainda possui ${emBranco} questão(ões) em branco de um total de ${total}. Deseja finalizar mesmo assim?`;
    document.getElementById('confirm-modal').classList.add('active');
  } else {
    calcularERexibirResultado();
  }
}

// Processa pontuação e gera o Grid
function calcularERexibirResultado() {
  fecharModal('confirm-modal');

  let acertos = 0;
  let erros = 0;
  const gridContainer = document.getElementById('questoes-grid');
  gridContainer.innerHTML = '';

  questoesAtuais.forEach((q, index) => {
    const num = q.numero || q.id || (index + 1);
    const selecionada = document.querySelector(`input[name="q_${num}"]:checked`);
    const respUsuario = selecionada ? selecionada.value.toUpperCase() : 'N/A';
    const gabarito = (q.resposta_correta || q.gabarito || '').toUpperCase();

    const eCorreta = respUsuario === gabarito;

    if (eCorreta) {
      acertos++;
    } else {
      erros++;
    }

    // Cria o quadradinho com o número da questão
    const btnNum = document.createElement('button');
    btnNum.className = `btn-num-questao ${eCorreta ? 'certo' : 'errado'}`;
    btnNum.innerText = num;

    if (!eCorreta) {
      btnNum.onclick = () => abrirRevisaoQuestao(q, num, respUsuario, gabarito);
    }

    gridContainer.appendChild(btnNum);
  });

  const total = questoesAtuais.length;
  const porcentagem = total > 0 ? Math.round((acertos / total) * 100) : 0;

  document.getElementById('res-acertos').innerText = acertos;
  document.getElementById('res-erros').innerText = erros;
  document.getElementById('res-porcentagem').innerText = `${porcentagem}%`;

  document.getElementById('result-modal').classList.add('active');
}

// Exibe detalhes da questão errada ao clicar no número vermelho
function abrirRevisaoQuestao(q, num, respUsuario, gabarito) {
  document.getElementById('rev-titulo').innerText = `Questão ${num}`;
  document.getElementById('rev-enunciado').innerText = q.enunciado || q.texto || q.raw_content || '';
  
  const textoSuaResp = q.alternativas && q.alternativas[respUsuario] ? `${respUsuario}) ${q.alternativas[respUsuario]}` : respUsuario;
  const textoGabarito = q.alternativas && q.alternativas[gabarito] ? `${gabarito}) ${q.alternativas[gabarito]}` : gabarito;

  document.getElementById('rev-sua-resposta').innerText = textoSuaResp;
  document.getElementById('rev-gabarito').innerText = textoGabarito;

  // Dica prática personalizada
  document.getElementById('rev-dica').innerHTML = `
    📌 <strong>Instrução Strix de Memorização:</strong><br>
    Copie para seu caderno de resumos apenas a opção correta: <mark style="background: rgba(124, 58, 237, 0.3); color: #fff; padding: 2px 6px; border-radius: 4px;">${textoGabarito}</mark>.<br>
    <em>Evite copiar opções incorretas para não treinar seu cérebro com conteúdos falsos.</em>
  `;

  document.getElementById('review-modal').classList.add('active');
}

function fecharModal(id) {
  document.getElementById(id).classList.remove('active');
}async function processarGabaritoPDF() {
  const fileInput = document.getElementById('pdf-gabarito-input');
  const jsonTextArea = document.getElementById('json-output');

  if (!fileInput.files.length) {
    alert('Por favor, selecione o arquivo PDF do gabarito.');
    return;
  }

  if (!jsonTextArea.value) {
    alert('Primeiro converta a prova em PDF para JSON!');
    return;
  }

  try {
    const file = fileInput.files[0];
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let textoGabarito = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      textoGabarito += textContent.items.map(i => i.str).join(' ') + " ";
    }

    // Procura padrões comuns de gabarito como: "1 - A", "01. A", "1 A", "Q1: A"
    const mapaGabarito = {};
    const regex = /(?:Q(?:uestão)?\s*)?(\d{1,3})[\s\.\-\:]*([A-E])/gi;
    let match;

    while ((match = regex.exec(textoGabarito)) !== null) {
      const numQuestao = parseInt(match[1]);
      const letraCorreta = match[2].toUpperCase();
      mapaGabarito[numQuestao] = letraCorreta;
    }

    // Injeta a resposta_correta na lista de questões do JSON
    const questoes = JSON.parse(jsonTextArea.value);
    let atualizadas = 0;

    questoes.forEach(q => {
      const num = q.numero || q.id;
      if (mapaGabarito[num]) {
        q.resposta_correta = mapaGabarito[num];
        q.gabarito = mapaGabarito[num];
        atualizadas++;
      }
    });

    jsonTextArea.value = JSON.stringify(questoes, null, 2);
    alert(`Gabarito injetado com sucesso! ${atualizadas} questões atualizadas.`);

  } catch (erro) {
    console.error('Erro ao ler gabarito:', erro);
    alert('Erro ao processar o PDF do gabarito. Verifique o arquivo.');
  }
}