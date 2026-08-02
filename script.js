// --- ESTADOS DA APLICAÇÃO ---
let listaProvas = [];
let provaOriginal = null;     // Guarda a prova completa
let provaFiltrada = [];       // Guarda as questões do filtro atual
let indexAtual = 0;

// Estados do Usuário
let respostas = {};           // Ex: { 1: "A" }
let eliminadas = {};          // Ex: { 1: ["B", "D"] } -> opções riscadas
let paraRevisar = new Set();  // Guardar números das questões marcadas com dúvida
let modoEstudoDireto = true;  // Modo Treino (true) vs Simulado (false)

// 1. Ao carregar a página, busca o catálogo master de provas
window.addEventListener('DOMContentLoaded', async () => {
  await carregarCatalogoProvas();
});

async function carregarCatalogoProvas() {
  try {
    const resposta = await fetch('./provas/index.json');
    listaProvas = await resposta.json();

    const seletor = document.getElementById('seletorProvas');
    seletor.innerHTML = '<option value="">-- Escolha um Simulado --</option>';

    listaProvas.forEach(p => {
      const option = document.createElement('option');
      option.value = p.arquivo;
      option.innerText = `${p.banca} (${p.ano}) - ${p.titulo}`;
      seletor.appendChild(option);
    });
  } catch (erro) {
    console.error("Erro ao carregar o catálogo de provas:", erro);
  }
}

// 2. Carrega a prova selecionada no menu suspenso
async function carregarProva(caminhoArquivo) {
  if (!caminhoArquivo) return;

  try {
    const resposta = await fetch(caminhoArquivo);
    provaOriginal = await resposta.json();
    
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
    console.error("Erro ao carregar o arquivo da prova:", erro);
  }
}

// 3. Preenche as matérias no filtro superior
function atualizarFiltroDisciplinas() {
  const selectDisc = document.getElementById('filtroDisciplina');
  selectDisc.innerHTML = '<option value="todas">Todas as Disciplinas</option>';

  const disciplinas = [...new Set(provaOriginal.questoes.map(q => q.disciplina))];
  
  disciplinas.forEach(disc => {
    const opt = document.createElement('option');
    opt.value = disc;
    opt.innerText = disc;
    selectDisc.appendChild(opt);
  });
}

// 4. Filtrar por Disciplina
function aplicarFiltroDisciplina(disciplinaSelecionada) {
  if (!disciplinaSelecionada || disciplinaSelecionada === "todas") {
    provaFiltrada = [...provaOriginal.questoes];
  } else {
    provaFiltrada = provaOriginal.questoes.filter(q => q.disciplina === disciplinaSelecionada);
  }
  indexAtual = 0;
  renderizarQuestao();
}

// 5. Renderizar Questão na Tela
function renderizarQuestao() {
  const q = provaFiltrada[indexAtual];
  if (!q) return;

  const num = q.numero;
  
  // Atualiza Contador do Rodapé (ex: Questão 1 de 70)
  document.getElementById('contador-questoes').innerText = `Questão ${indexAtual + 1} de ${provaFiltrada.length}`;

  // Atualiza Badge de Disciplina
  document.getElementById('info-disciplina').innerText = q.disciplina;

  // Atualiza Botão de Revisão
  const btnRevisar = document.getElementById('btn-revisar');
  if (paraRevisar.has(num)) {
    btnRevisar.classList.add('em-revisao');
    btnRevisar.innerText = '🚩 Marcada p/ Revisão';
  } else {
    btnRevisar.classList.remove('em-revisao');
    btnRevisar.innerText = '🏳️ Marcar p/ Revisão';
  }

  // Renderiza Enunciado
  document.getElementById('enunciado').innerText = `${q.numero}. ${q.enunciado}`;
  
  // Renderiza Alternativas
  const container = document.getElementById('opcoes');
  container.innerHTML = '';

  Object.entries(q.alternativas).forEach(([letra, texto]) => {
    const div = document.createElement('div');
    div.className = 'opcao-item';

    const foiMarcada = respostas[num] === letra;
    const foiEliminada = (eliminadas[num] || []).includes(letra);

    if (foiMarcada) div.classList.add('selecionada');
    if (foiEliminada) div.classList.add('riscada');

    // Modo Treino: destaca verde/vermelho se já respondeu
    if (modoEstudoDireto && respostas[num]) {
      if (letra === q.resposta_correta) div.classList.add('correta');
      else if (foiMarcada && letra !== q.resposta_correta) div.classList.add('incorreta');
    }

    div.innerHTML = `<strong>(${letra})</strong> ${texto}`;

    // Clique Esquerdo: Seleciona alternativa
    div.onclick = () => {
      respostas[num] = letra;
      renderizarQuestao();
    };

    // Clique Direito: Risca a alternativa
    div.oncontextmenu = (e) => {
      e.preventDefault();
      toggleEliminarOpcao(num, letra);
    };

    container.appendChild(div);
  });
}

// 6. Navegar entre as questões (Anterior / Próxima)
function mudarQuestao(direcao) {
  const novoIndex = indexAtual + direcao;
  if (novoIndex >= 0 && novoIndex < provaFiltrada.length) {
    indexAtual = novoIndex;
    renderizarQuestao();
  }
}

// 7. Riscar / Desriscar Opção
function toggleEliminarOpcao(numQuestao, letra) {
  if (!eliminadas[numQuestao]) eliminadas[numQuestao] = [];
  
  const index = eliminadas[numQuestao].indexOf(letra);
  if (index > -1) {
    eliminadas[numQuestao].splice(index, 1);
  } else {
    eliminadas[numQuestao].push(letra);
  }
  renderizarQuestao();
}

// 8. Alternar Modo Treino / Modo Simulado
function toggleModoEstudo(checked) {
  modoEstudoDireto = checked;
  renderizarQuestao();
}

// 9. Alternar Marcação de Revisão
function toggleRevisao() {
  const q = provaFiltrada[indexAtual];
  if (paraRevisar.has(q.numero)) {
    paraRevisar.delete(q.numero);
  } else {
    paraRevisar.add(q.numero);
  }
  renderizarQuestao();
}

// 10. Finalizar e Mostrar Desempenho
function calcularResultado() {
  let acertos = 0;
  let total = provaOriginal.questoes.length;

  provaOriginal.questoes.forEach(q => {
    if (respostas[q.numero] === q.resposta_correta) {
      acertos++;
    }
  });

  alert(`Você finalizou o simulado!\n\nAcertos: ${acertos} de ${total} (${((acertos/total)*100).toFixed(1)}%)`);
}
