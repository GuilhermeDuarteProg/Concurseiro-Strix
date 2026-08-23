document.addEventListener('DOMContentLoaded', () => {
  // Elementos de Navegação
  const navLinks = document.querySelectorAll('.nav-links a');
  const tabContents = document.querySelectorAll('.tab-content');

  // Função para alternar as abas
  function switchTab(targetTabId) {
    // 1. Remove classe 'active' de todas as abas no menu
    navLinks.forEach(link => link.classList.remove('active'));

    // 2. Esconde todas as seções
    tabContents.forEach(content => content.classList.remove('active'));

    // 3. Ativa o link clicado no menu
    const activeLink = document.querySelector(`.nav-links a[data-tab="${targetTabId}"]`);
    if (activeLink) {
      activeLink.classList.add('active');
    }

    // 4. Exibe o conteúdo correspondente
    const activeSection = document.getElementById(`tab-${targetTabId}`);
    if (activeSection) {
      activeSection.classList.add('active');
    }
  }

  // Adiciona evento de clique em cada link da Navbar
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTab = link.getAttribute('data-tab');
      if (targetTab) {
        switchTab(targetTab);
      }
    });
  });

  // Suporte para botões internos que trocam de aba (ex: "Ir para as Questões")
  const actionButtons = document.querySelectorAll('[data-tab]');
  actionButtons.forEach(button => {
    if (!button.classList.contains('nav-links')) {
      button.addEventListener('click', (e) => {
        const targetTab = button.getAttribute('data-tab');
        if (targetTab && !button.closest('.nav-links')) {
          e.preventDefault();
          switchTab(targetTab);
        }
      });
    }
  });

  // Evento para seleção de alternativas
  document.addEventListener('click', (e) => {
    const altItem = e.target.closest('.alternative-item');
    if (!altItem) return;

    // Garante seleção única no grupo de alternativas
    const parent = altItem.closest('.simulado-opcoes') || altItem.parentElement;
    parent.querySelectorAll('.alternative-item').forEach(item => item.classList.remove('selected'));

    // Marca o item atual
    altItem.classList.add('selected');

    // Marca o input radio correspondente se existir
    const radio = altItem.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
  });

  // Evento de envio do formulário de início ao Simulado
  const simForm = document.getElementById('sim-form');
  simForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const simTitulo = document.getElementById('simTitulo').value;
    const simDisciplina = document.getElementById('simDisciplina').value;
    const simTempo = document.getElementById('simTempo').value;

    // Aqui você pode realizar as ações necessárias com os valores dos campos do formulário
    console.log('Simulado iniciado:', simTitulo, simDisciplina, simTempo);
  });

  // Evento de envio do formulário de geração do Simulado
  const simuladoForm = document.getElementById('simulado-form');
  simuladoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const simuladoTitulo = document.getElementById('simuladoTitulo').value;
    const simuladoDisciplina = document.getElementById('simuladoDisciplina').value;

    // Aqui você pode realizar as ações necessárias com os valores dos campos do formulário
    console.log('Simulado gerado:', simuladoTitulo, simuladoDisciplina);
  });
});