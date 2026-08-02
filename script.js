let listaProvas = [];
let provaOriginal = null;
let provaFiltrada = [];
let indexAtual = 0;

// 1. Ao carregar a página, busca o catálogo master de provas
async function carregarCatalogoProvas() {
  try {
    const resposta = await fetch('./provas/index.json');
    listaProvas = await resposta.json();

    const seletor = document.getElementById('seletorProvas');
    seletor.innerHTML = '<option value="">-- Escolha um Simulado --</option>';

    listaProvas.forEach((p, index) => {
      const option = document.createElement('option');
      option.value = index; // Passa o índice da prova na lista
      option.innerText = `${p.banca} (${p.ano}) - ${p.titulo}`;
      seletor.appendChild(option);
    });
  } catch (erro) {
    console.error("Erro ao carregar o catálogo de provas:", erro);
  }
}

// 2. Carrega a prova e une com o arquivo de gabarito
async function carregarProva(indexLista) {
  if (indexLista === "" || indexLista === undefined) return;

  const itemProva = listaProvas[indexLista];

  try {
    // Busca a prova e o gabarito simultaneamente
    const [resProva, resGabarito] = await Promise.all([
      fetch(itemProva.arquivo),
      fetch(itemProva.gabarito)
    ]);

    provaOriginal = await resProva.json();
    const gabaritoMap = await resGabarito.json();

    // Mescla o gabarito dentro de cada questão da prova
    provaOriginal.questoes.forEach(q => {
      if (gabaritoMap[q.numero]) {
        q.resposta_correta = gabaritoMap[q.numero];
      }
    });

    // Reseta estados anteriores
    respostas = {};
    eliminadas = {};
    paraRevisar.clear();

    atualizarFiltroDisciplinas();

    provaFiltrada = [...provaOriginal.questoes];
    indexAtual = 0;

    document.getElementById('area-estudo').classList.remove('oculto');
    renderizarQuestao();
  } catch (erro) {
    console.error("Erro ao carregar os dados da prova ou gabarito:", erro);
  }
}

// Preenche o filtro de disciplinas de acordo com a prova atual
function atualizarFiltroDisciplinas() {
  const selectDisc = document.getElementById('filtroDisciplina');
  selectDisc.innerHTML = '<option value="todas">Todas as Disciplinas</option>';

  // Extrai disciplinas únicas da prova selecionada
  const disciplinas = [...new Set(provaOriginal.questoes.map(q => q.disciplina))];
  
  disciplinas.forEach(disc => {
    const opt = document.createElement('option');
    opt.value = disc;
    opt.innerText = disc;
    selectDisc.appendChild(opt);
  });
}
let provaOriginal = null;     // Guarda a prova completa
let provaFiltrada = [];       // Guarda as questões do filtro atual
let indexAtual = 0;

// Estados do Usuário
let respostas = {};           // Ex: { 1: "A" }
let eliminadas = {};          // Ex: { 1: ["B", "D"] } -> opções riscadas
let paraRevisar = new Set();  // Guardar números das questões marcadas com dúvida

// Modo de Estudo: true = mostra resposta na hora | false = modo simulado
let modoEstudoDireto = true; 

// 1. Filtrar por Disciplina (Ex: Apenas "Língua Portuguesa")
function aplicarFiltroDisciplina(disciplinaSelecionada) {
  if (!disciplinaSelecionada || disciplinaSelecionada === "todas") {
    provaFiltrada = [...provaOriginal.questoes];
  } else {
    provaFiltrada = provaOriginal.questoes.filter(q => q.disciplina === disciplinaSelecionada);
  }
  indexAtual = 0;
  renderizarQuestao();
}

// 2. Renderizar Questão com Recursos Avançados
function renderizarQuestao() {
  const q = provaFiltrada[indexAtual];
  if (!q) return;

  const num = q.numero;
  
  // Atualiza botão de "Marcar para Revisão"
  const btnRevisar = document.getElementById('btn-revisar');
  if (paraRevisar.has(num)) {
    btnRevisar.classList.add('em-revisao');
    btnRevisar.innerText = '🚩 Marcada p/ Revisão';
  } else {
    btnRevisar.classList.remove('em-revisao');
    btnRevisar.innerText = '🏳️ Marcar p/ Revisão';
  }

  document.getElementById('enunciado').innerText = `${q.numero}. ${q.enunciado}`;
  
  // Renderizar Alternativas com suporte a Riscar / Selecionar
  const container = document.getElementById('opcoes');
  container.innerHTML = '';

  Object.entries(q.alternativas).forEach(([letra, texto]) => {
    const div = document.createElement('div');
    div.className = 'opcao-item';

    // Checa se a opção está marcada ou eliminada
    const foiMarcada = respostas[num] === letra;
    const foiEliminada = (eliminadas[num] || []).includes(letra);

    if (foiMarcada) div.classList.add('selecionada');
    if (foiEliminada) div.classList.add('riscada');

    // Se estiver no Modo Estudo e já respondeu, destaca Certo/Errado
    if (modoEstudoDireto && respostas[num]) {
      if (letra === q.resposta_correta) div.classList.add('correta');
      else if (foiMarcada && letra !== q.resposta_correta) div.classList.add('incorreta');
    }

    div.innerHTML = `<strong>(${letra})</strong> ${texto}`;

    // Clique Normal: Marcar a resposta
    div.onclick = () => {
      respostas[num] = letra;
      renderizarQuestao();
    };

    // Clique com Botão Direito: Riscar / Desriscar a alternativa
    div.oncontextmenu = (e) => {
      e.preventDefault(); // Impede o menu do navegador de abrir
      toggleEliminarOpcao(num, letra);
    };

    container.appendChild(div);
  });
}

// 3. Função para Alternar a Eliminação (Riscar) de uma opção
function toggleEliminarOpcao(numQuestao, letra) {
  if (!eliminadas[numQuestao]) eliminadas[numQuestao] = [];
  
  const index = eliminadas[numQuestao].indexOf(letra);
  if (index > -1) {
    eliminadas[numQuestao].splice(index, 1); // Remove o risco
  } else {
    eliminadas[numQuestao].push(letra);      // Adiciona o risco
  }
  renderizarQuestao();
}

// 4. Alternar Dúvida / Revisão
function toggleRevisao() {
  const q = provaFiltrada[indexAtual];
  if (paraRevisar.has(q.numero)) {
    paraRevisar.delete(q.numero);
  } else {
    paraRevisar.add(q.numero);
  }
  renderizarQuestao();
}

// 5. Finalizar e Calcular Nota por Disciplina
function calcularResultado() {
  let acertosPorMateria = {};
  let totalPorMateria = {};

  provaOriginal.questoes.forEach(q => {
    const disc = q.disciplina;
    const resp = respostas[q.numero];
    
    totalPorMateria[disc] = (totalPorMateria[disc] || 0) + 1;
    
    if (resp && resp === q.resposta_correta) {
      acertosPorMateria[disc] = (acertosPorMateria[disc] || 0) + 1;
    }
  });

  console.log("Resumo do Desempenho:", acertosPorMateria, totalPorMateria);
  // Aqui você pode abrir um modal mostrando a % de acerto em Português, Inglês, etc.
}
