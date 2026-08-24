/* ==========================================================================
   1. INICIALIZAÇÃO E NAVEGAÇÃO / MODAIS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  loadStudyPlan();
  carregarCatalogoProvas();
});

// Alterna a exibição das seções da página via ID
function mudarAba(idAba, event) {
  if (event) {
    event.preventDefault();
  }

  // Esconde todas as seções principais
  const abas = document.querySelectorAll('.aba-conteudo, .tab-content');
  abas.forEach(aba => aba.style.display = 'none');

  // Remove estado ativo dos links de navegação
  document.querySelectorAll('nav a').forEach(link => {
    link.classList.remove('active');
  });

  // Exibe a aba solicitada
  const abaAlvo = document.getElementById(idAba);
  if (abaAlvo) {
    abaAlvo.style.display = 'block';
  } else {
    console.error(`Aba com ID "${idAba}" não foi encontrada.`);
  }

  // Ativa o link da navegação correspondente (se houver)
  const targetBtn = document.querySelector(`nav a[href="#${idAba}"]`);
  if (targetBtn) {
    targetBtn.classList.add('active');
  }
}

// Mantido para compatibilidade com rotas estilo switchTab
function switchTab(tabId, event) {
  mudarAba(tabId, event);
}

function openLoginModal() {
  document.getElementById('login-modal').classList.add('active');
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('active');
}

function fecharModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
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

/* ==========================================================================
   2. PLANO DE ESTUDOS (LOCALSTORAGE)
   ========================================================================== */

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

/* ==========================================================================
   3. CONVERSÃO E PROCESSAMENTO DE PDF (ADMIN / FERRAMENTAS)
   ========================================================================== */

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

async function processarGabaritoPDF() {
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

    const mapaGabarito = {};
    const regex = /(?:Q(?:uestão)?\s*)?(\d{1,3})[\s\.\-\:]*([A-E])/gi;
    let match;

    while ((match = regex.exec(textoGabarito)) !== null) {
      const numQuestao = parseInt(match[1]);
      const letraCorreta = match[2].toUpperCase();
      mapaGabarito[numQuestao] = letraCorreta;
    }

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

function mesclarEBaixarProva() {
  const inputQuestoes = document.getElementById('admin-json-questoes').value.trim();
  const inputGabarito = document.getElementById('admin-json-gabarito').value.trim();
  const areaResultado = document.getElementById('admin-json-resultado');

  if (!inputQuestoes || !inputGabarito) {
    alert('Por favor, cole tanto o JSON das Questões quanto o JSON do Gabarito!');
    return;
  }

  try {
    let dadosProva = JSON.parse(inputQuestoes);
    const gabaritoBruto = JSON.parse(inputGabarito);

    // Normaliza gabarito
    const mapaGabarito = {};
    Object.keys(gabaritoBruto).forEach(ch => {
      const num = ch.replace(/\D/g, '');
      if (num) mapaGabarito[num] = String(gabaritoBruto[ch]).trim().toUpperCase();
    });

    // Encontra o array de questões onde quer que ele esteja
    let listaQuestoes = [];
    if (Array.isArray(dadosProva)) {
      listaQuestoes = dadosProva;
    } else {
      // Varre todas as chaves do objeto até achar um Array que pareça conter as questões
      for (let chave in dadosProva) {
        if (Array.isArray(dadosProva[chave]) && dadosProva[chave].length > 0) {
          listaQuestoes = dadosProva[chave];
          break;
        }
      }
    }

    if (listaQuestoes.length === 0) {
      alert('Nenhum array de questões foi localizado no JSON das questões.');
      return;
    }

    let atualizadas = 0;

    listaQuestoes.forEach((q, idx) => {
      // Procura qualquer propriedade numérica no objeto da questão
      let numQuestao = null;
      
      if (typeof q === 'object' && q !== null) {
        numQuestao = q.numero ?? q.id ?? q.questao ?? q.num_questao;
      }

      // Se a questão não tiver campo de número explícito, usa a posição do índice (1, 2, 3...)
      const chaveBusca = numQuestao ? String(numQuestao).replace(/\D/g, '') : String(idx + 1);

      if (mapaGabarito[chaveBusca]) {
        q.resposta_correta = mapaGabarito[chaveBusca];
        q.gabarito = mapaGabarito[chaveBusca];
        atualizadas++;
      }
    });

    const jsonFinal = JSON.stringify(dadosProva, null, 2);
    if (areaResultado) areaResultado.value = jsonFinal;

    // Faz o download
    const blob = new Blob([jsonFinal], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'transpetro-2023-administracao.json';
    link.click();

    alert(`Sucesso! ${atualizadas} questões foram associadas ao gabarito.`);
  } catch (erro) {
    console.error('Erro ao mesclar:', erro);
    alert('Erro de sintaxe no JSON colado. Verifique se copiou o JSON completo.');
  }
}

/* ==========================================================================
   4. SISTEMA DE SIMULADOS E RESOLUÇÃO DE QUESTÕES
   ========================================================================== */

let questoesAtuais = [];

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

const GABARITO_TRANSPETRO = {
  "1": "E", "2": "D", "3": "C", "4": "A", "5": "B",
  "6": "E", "7": "A", "8": "D", "9": "C", "10": "B",
  "11": "E", "12": "D", "13": "C", "14": "A", "15": "D",
  "16": "E", "17": "C", "18": "C", "19": "B", "20": "C",
  "21": "C", "22": "B", "23": "C", "24": "A", "25": "D",
  "26": "D", "27": "E", "28": "E", "29": "A", "30": "D",
  "31": "C", "32": "E", "33": "B", "34": "B", "35": "C",
  "36": "E", "37": "C", "38": "B", "39": "D", "40": "A",
  "41": "C", "42": "B", "43": "A", "44": "A", "45": "C",
  "46": "B", "47": "A", "48": "E", "49": "E", "50": "D",
  "51": "A", "52": "E", "53": "C", "54": "E", "55": "B",
  "56": "C", "57": "A", "58": "A", "59": "D", "60": "B",
  "61": "E", "62": "C", "63": "A", "64": "B", "65": "B",
  "66": "D", "67": "B", "68": "B", "69": "E", "70": "D"
};

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

    // Mapeia os textos de suporte pelo ID
    const mapaTextos = {};
    if (dadosProva.textos_suporte && Array.isArray(dadosProva.textos_suporte)) {
      dadosProva.textos_suporte.forEach(txt => {
        mapaTextos[txt.id] = txt;
      });
    }

    let questoesBrutas = Array.isArray(dadosProva) ? dadosProva : (dadosProva.questoes || []);

    if (questoesBrutas.length === 0) {
      areaQuestoes.innerHTML = '<p>Nenhuma questão encontrada para este simulado.</p>';
      return;
    }

    // Vincula o gabarito oficial
    const gabaritoOficial = dadosProva.gabarito_oficial || GABARITO_TRANSPETRO || {};

    questoesAtuais = questoesBrutas.map((q, index) => {
      const num = q.numero || q.id || (index + 1);
      const respCorreta = q.resposta_correta || q.gabarito || gabaritoOficial[num] || gabaritoOficial[String(num)] || '';

      return {
        ...q,
        numero: num,
        resposta_correta: String(respCorreta).toUpperCase(),
        gabarito: String(respCorreta).toUpperCase()
      };
    });

    let htmlContent = `<h2>${dadosProva.concurso || 'Simulado Transpetro 2023'}</h2><hr style="margin-bottom: 1.5rem; border-color: rgba(255,255,255,0.1);">`;

    questoesAtuais.forEach((q) => {
      const num = Number(q.numero);
      const disciplina = q.disciplina ? `<small style="color: #a78bfa; font-weight: bold;">${q.disciplina}</small><br>` : '';

      // Identifica o texto de apoio pela propriedade ou pela faixa de número da questão
      let idTexto = q.texto_id || q.id_texto;
      if (!idTexto) {
        if (num >= 1 && num <= 10) idTexto = "texto_portugues";
        else if (num >= 11 && num <= 15) idTexto = "texto_ingles";
      }

      const objetoTexto = mapaTextos[idTexto];
      let htmlTextoApoio = '';

      // Renderiza o texto de apoio na PRIMEIRA questão da disciplina ou se a questão exigir
      if (objetoTexto && (q.texto_id || num === 1 || num === 11)) {
        const paragrafos = (objetoTexto.paragrafos || []).map(p => `<p style="margin: 0.4rem 0;">${p}</p>`).join('');
        htmlTextoApoio = `
          <div style="background: rgba(255,255,255,0.04); border-left: 4px solid #a78bfa; padding: 1.2rem; margin: 1rem 0; border-radius: 6px; font-size: 0.95rem; line-height: 1.6;">
            <strong style="color: #a78bfa; font-size: 1.1rem; display: block; margin-bottom: 0.3rem;">${objetoTexto.titulo || 'Texto de Apoio'}</strong>
            ${objetoTexto.autor ? `<small style="color: #ccc;"><em>${objetoTexto.autor}</em></small><br>` : ''}
            <div style="margin-top: 0.8rem; text-align: justify; max-height: 300px; overflow-y: auto; padding-right: 0.5rem;">${paragrafos}</div>
            ${objetoTexto.referencia ? `<small style="color: #888; display: block; margin-top: 0.6rem;">${objetoTexto.referencia}</small>` : ''}
          </div>
        `;
      }

      htmlContent += `
        <div style="margin-bottom: 2rem; padding: 1.2rem; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
          ${disciplina}
          <strong style="font-size: 1.1rem;">Questão ${num}</strong>
          ${htmlTextoApoio}
          <p style="margin: 0.8rem 0; line-height: 1.5;">${q.enunciado || q.texto || q.raw_content || ''}</p>
          <div class="alternativas-container">
      `;

      if (q.alternativas) {
        Object.entries(q.alternativas).forEach(([letra, textoAlt]) => {
          htmlContent += `
            <label class="opcao-resposta" style="display: block; margin: 0.5rem 0; cursor: pointer; padding: 0.5rem; border-radius: 4px; background: rgba(255,255,255,0.02);">
              <input type="radio" name="q_${num}" value="${letra}" onchange="destacarOpcao && destacarOpcao(this)">
              <strong>${letra})</strong> ${textoAlt}
            </label>
          `;
        });
      }

      htmlContent += `</div></div>`;
    });

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

function destacarOpcao(inputRadio) {
  const container = inputRadio.closest('.alternativas-container');
  if (!container) return;

  container.querySelectorAll('.opcao-resposta').forEach(label => {
    label.classList.remove('selecionada');
  });

  const labelAtual = inputRadio.closest('.opcao-resposta');
  if (labelAtual) {
    labelAtual.classList.add('selecionada');
  }
}

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

function abrirRevisaoQuestao(q, num, respUsuario, gabarito) {
  document.getElementById('rev-titulo').innerText = `Questão ${num}`;
  document.getElementById('rev-enunciado').innerText = q.enunciado || q.texto || q.raw_content || '';
  
  const textoSuaResp = q.alternativas && q.alternativas[respUsuario] ? `${respUsuario}) ${q.alternativas[respUsuario]}` : respUsuario;
  const textoGabarito = q.alternativas && q.alternativas[gabarito] ? `${gabarito}) ${q.alternativas[gabarito]}` : gabarito;

  document.getElementById('rev-sua-resposta').innerText = textoSuaResp;
  document.getElementById('rev-gabarito').innerText = textoGabarito;

  document.getElementById('rev-dica').innerHTML = `
    📌 <strong>Instrução Strix de Memorização:</strong><br>
    Copie para seu caderno de resumos apenas a opção correta: <mark style="background: rgba(124, 58, 237, 0.3); color: #fff; padding: 2px 6px; border-radius: 4px;">${textoGabarito}</mark>.<br>
    <em>Evite copiar opções incorretas para não treinar seu cérebro com conteúdos falsos.</em>
  `;

  document.getElementById('review-modal').classList.add('active');
}

function aplicarGabaritoNaProva(dadosProva) {
  const gabarito = dadosProva.gabarito_oficial;

  dadosProva.questoes.forEach((questao, index) => {
    const num = questao.numero || (index + 1);
    if (gabarito[num]) {
      questao.resposta_correta = gabarito[num];
    }
  });

  return dadosProva.questoes;
}