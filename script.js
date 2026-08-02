// --- ESTADOS DA APLICAÇÃO ---
let listaProvas = [];
let provaOriginal = null;     // Guarda a prova completa
let provaFiltrada = [];       // Guarda as questões do filtro atual
let indexAtual = 0;

// Estados do Usuário
let respostas = {};           // Ex: { 1: "A" }
let eliminadas = {};          // Ex: { 1: ["B", "D"] }
let paraRevisar = new Set();  
let modoEstudoDireto = true;  

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

    listaProvas.forEach((p, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.innerText = `${p.banca} (${p.ano}) - ${p.titulo}`;
      seletor.appendChild(option);
    });
  } catch (erro) {
    console.error("Erro ao carregar o catálogo de provas:", erro);
  }
}

// 2. Carrega a prova selecionada e vincula o Gabarito com tratamento de erros
async function carregarProva(indexLista) {
  if (indexLista === "" || indexLista === undefined) return;

  const itemProva = listaProvas[indexLista];

  try {
    // Garante o caminho relativo correto
    const caminhoProva = itemProva.arquivo.startsWith('./') ? itemProva.arquivo : `./${itemProva.arquivo}`;
    const resProva = await fetch(caminhoProva);
    provaOriginal = await resProva.json();

    // Carrega e vincula o Gabarito
    if (itemProva.gabarito) {
      try {
        const caminhoGabarito = itemProva.gabarito.startsWith('./') ? itemProva.gabarito : `./${itemProva.gabarito}`;
        const resGabarito = await fetch(caminhoGabarito);
        const gabaritoMap = await resGabarito.json();

        // Mapeia o gabarito para cada questão
        provaOriginal.questoes.forEach(q => {
          const numStr = String(q.numero);
          const numPadded = numStr.padStart(2, '0');

          const respGabarito = gabaritoMap[numStr] || gabaritoMap[numPadded] || gabaritoMap[`q${numStr}`];

          if (respGabarito) {
            q.resposta_correta = String(respGabarito).trim().toUpperCase();
          } else {
            console.warn(`Atenção: Gabarito da questão ${q.numero} não encontrado no JSON.`);
          }
        });
      } catch (eGab) {
        console.error("Erro ao carregar o arquivo de gabarito:", eGab);
      }
    }

    // Reseta estados do simulado
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

  // --- RENDEREIZAÇÃO DO TEXTO DE APOIO ---
  const painelTexto = document.getElementById('texto-apoio');
  painelTexto.innerHTML = '';

  if (provaOriginal.textos_suporte && provaOriginal.textos_suporte.length > 0) {
    let textoEncontrado = null;

    if (q.disciplina === "Língua Portuguesa") {
      textoEncontrado = provaOriginal.textos_suporte.find(t => t.id === "texto_portugues");
    } else if (q.disciplina === "Língua Inglesa") {
      textoEncontrado = provaOriginal.textos_suporte.find(t => t.id === "texto_ingles");
    }

    if (textoEncontrado) {
      painelTexto.classList.remove('oculto');
      let html = `<h3>${textoEncontrado.titulo}</h3>`;
      if (textoEncontrado.autor) html += `<p><strong>${textoEncontrado.autor}</strong></p>`;
      if (textoEncontrado.referencia) html += `<p><small><i>${textoEncontrado.referencia}</i></small></p><br>`;
      
      textoEncontrado.paragrafos.forEach(p => {
        html += `<p style="margin-bottom: 0.6rem;">${p}</p>`;
      });
      painelTexto.innerHTML = html;
    } else {
      painelTexto.classList.add('oculto');
    }
  } else {
    painelTexto.classList.add('oculto');
  }

  // Contador e Disciplina
  document.getElementById('contador-questoes').innerText = `Questão ${indexAtual + 1} de ${provaFiltrada.length}`;
  document.getElementById('info-disciplina').innerText = q.disciplina;

  // Botão de Revisão
  const btnRevisar = document.getElementById('btn-revisar');
  if (paraRevisar.has(num)) {
    btnRevisar.classList.add('em-revisao');
    btnRevisar.innerText = '🚩 Marcada p/ Revisão';
  } else {
    btnRevisar.classList.remove('em-revisao');
    btnRevisar.innerText = '🏳️ Marcar p/ Revisão';
  }

  // Enunciado
  document.getElementById('enunciado').innerText = `${q.numero}. ${q.enunciado}`;

  // Alternativas
  const container = document.getElementById('opcoes');
  container.innerHTML = '';

  Object.entries(q.alternativas).forEach(([letra, texto]) => {
    const div = document.createElement('div');
    div.className = 'opcao-item';

    const foiMarcada = respostas[num] === letra;
    const foiEliminada = (eliminadas[num] || []).includes(letra);

    if (foiMarcada) div.classList.add('selecionada');
    if (foiEliminada) div.classList.add('riscada');

    // Modo Treino (Gabarito imediato ao responder)
    if (modoEstudoDireto && respostas[num]) {
      if (letra === q.resposta_correta) div.classList.add('correta');
      else if (foiMarcada && letra !== q.resposta_correta) div.classList.add('incorreta');
    }

    div.innerHTML = `<strong>(${letra})</strong> ${texto}`;

    div.onclick = () => {
      respostas[num] = letra;
      renderizarQuestao();
    };

    div.oncontextmenu = (e) => {
      e.preventDefault();
      toggleEliminarOpcao(num, letra);
    };

    container.appendChild(div);
  });
}

// 6. Navegação
function mudarQuestao(direcao) {
  const novoIndex = indexAtual + direcao;
  if (novoIndex >= 0 && novoIndex < provaFiltrada.length) {
    indexAtual = novoIndex;
    renderizarQuestao();
  }
}

// 7. Eliminar / Riscar opção
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

// 8. Trocar modo de estudo
function toggleModoEstudo(checked) {
  modoEstudoDireto = checked;
  renderizarQuestao();
}

// 9. Marcação para revisão
function toggleRevisao() {
  const q = provaFiltrada[indexAtual];
  if (paraRevisar.has(q.numero)) {
    paraRevisar.delete(q.numero);
  } else {
    paraRevisar.add(q.numero);
  }
  renderizarQuestao();
}

// 10. Função de Cálculo e Exibição do Gabarito / Correção
function calcularResultado() {
  if (!provaOriginal || !provaOriginal.questoes) return;

  const total = provaOriginal.questoes.length;
  const respondidas = Object.keys(respostas).length;

  if (respondidas < total) {
    const confirmar = confirm(
      `Atenção: Você respondeu apenas ${respondidas} de ${total} questões.\n\n` +
      `Deseja realmente finalizar e ver o gabarito agora?`
    );
    if (!confirmar) return;
  }

  let acertos = 0;

  provaOriginal.questoes.forEach(q => {
    const respUsuario = respostas[q.numero];
    const gabarito = q.resposta_correta;
    if (respUsuario && gabarito && respUsuario === gabarito) {
      acertos++;
    }
  });

  const porcentagem = ((acertos / total) * 100).toFixed(1);

  // Esconde área de prova e exibe a tela de resultado
  document.getElementById('area-estudo').classList.add('oculto');
  document.getElementById('tela-resultado').classList.remove('oculto');

  // Preenche dados do header
  document.getElementById('resultado-porcentagem').innerText = `${porcentagem}%`;
  document.getElementById('resultado-detalhe-texto').innerText = `Das ${total} questões você acertou ${acertos}`;

  const badgeStatus = document.getElementById('badge-desempenho');
  if (porcentagem >= 70) {
    badgeStatus.innerText = "Excelente Desempenho!";
    badgeStatus.className = "status-desempenho aprovado";
  } else {
    badgeStatus.innerText = "Precisa Praticar Mais";
    badgeStatus.className = "status-desempenho reprovado";
  }

  // Gera a Grid de Questões (Estilo Detran)
  renderizarGridGabarito();

  // Seleciona a primeira questão por padrão
  carregarRevisaoQuestao(1);
}

// Renderiza a Grid de Botões Numéricos
function renderizarGridGabarito() {
  const container = document.getElementById('grid-numeros-gabarito');
  container.innerHTML = '';

  provaOriginal.questoes.forEach(q => {
    const btn = document.createElement('button');
    btn.className = 'btn-grid-num';
    btn.innerText = q.numero;
    btn.id = `btn-grid-${q.numero}`;

    const respUsuario = respostas[q.numero];
    const gabarito = q.resposta_correta;

    if (!respUsuario) {
      btn.classList.add('embranco');
    } else if (respUsuario === gabarito) {
      btn.classList.add('correta');
    } else {
      btn.classList.add('incorreta');
    }

    btn.onclick = () => carregarRevisaoQuestao(q.numero);
    container.appendChild(btn);
  });
}

// Renderiza os detalhes da questão clicada no Gabarito
function carregarRevisaoQuestao(numQuestao) {
  // Destaca o botão selecionado na grid
  document.querySelectorAll('.btn-grid-num').forEach(b => b.classList.remove('ativo'));
  const btnAtivo = document.getElementById(`btn-grid-${numQuestao}`);
  if (btnAtivo) btnAtivo.classList.add('ativo');

  const q = provaOriginal.questoes.find(item => item.numero === numQuestao);
  if (!q) return;

  const respUsuario = respostas[q.numero];
  const gabarito = q.resposta_correta;

  let statusClasse = 'embranco';
  let textoBanner = 'ESTA QUESTÃO NÃO FOI RESPONDIDA';

  if (respUsuario) {
    if (respUsuario === gabarito) {
      statusClasse = 'acerto';
      textoBanner = 'VOCÊ ACERTOU ESTA QUESTÃO!';
    } else {
      statusClasse = 'erro';
      textoBanner = 'QUE PENA! VOCÊ ERROU ESTA QUESTÃO';
    }
  }

  let htmlOpcoes = '';
  Object.entries(q.alternativas).forEach(([letra, texto]) => {
    let classeOpcao = 'opcao-revisao';

    if (letra === gabarito) {
      classeOpcao += ' correta';
    } else if (respUsuario === letra && letra !== gabarito) {
      classeOpcao += ' marcada-errada';
    }

    htmlOpcoes += `<div class="${classeOpcao}"><strong>(${letra})</strong> ${texto}</div>`;
  });

  const painel = document.getElementById('painel-revisao-questao');
  painel.innerHTML = `
    <div class="revisao-corpo">
      <div class="revisao-enunciado">
        <strong>${q.numero}.</strong> ${q.enunciado}
      </div>
      <div class="revisao-opcoes">
        ${htmlOpcoes}
      </div>
    </div>
    <div class="banner-feedback-rodape ${statusClasse}">
      ${textoBanner}
    </div>
  `;
}

// Função para retornar à prova
function voltarAoSimulado() {
  document.getElementById('tela-resultado').classList.add('oculto');
  document.getElementById('area-estudo').classList.remove('oculto');
}
  );
}
