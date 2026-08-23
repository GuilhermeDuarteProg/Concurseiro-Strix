import json
import os
import time

CAMINHO_JSON = 'questoes.json'

def adicionar_questao(dados):
    # 1. Carrega o banco existente ou cria uma lista vazia
    if os.path.exists(CAMINHO_JSON):
        with open(CAMINHO_JSON, 'r', encoding='utf-8') as f:
            try:
                banco = json.load(f)
            except json.JSONDecodeError:
                banco = []
    else:
        banco = []

    # 2. Gera ID automático se não informado
    if 'id' not in dados or not dados['id']:
        dados['id'] = f"transpetro-{dados.get('ano', 2026)}-{int(time.time() * 1000) % 10000}"

    # 3. Garante que todos os campos obrigatórios tenham padrão
    nova_questao = {
        "id": str(dados.get('id')),
        "banca": dados.get('banca', "CESGRANRIO (Inspirada)"),
        "orgao": dados.get('orgao', "Transpetro"),
        "cargo": dados.get('cargo', "Engenheiro(a) de Processamento"),
        "ano": int(dados.get('ano', 2023)),
        "nivel": dados.get('nivel', "Superior"),
        "disciplina": dados.get('disciplina', "Conhecimentos Específicos"),
        "enunciado": dados.get('enunciado', ""),
        "alternativas": dados.get('alternativas', []),
        "respostaCorreta": dados.get('respostaCorreta', ""),
        "explicacao": dados.get('explicacao', "Sem explicação cadastrada."),
        "fonteLink": dados.get('fonteLink', "https://www.cesgranrio.org.br/")
    }

    # 4. Adiciona e salva no arquivo questoes.json
    banco.append(nova_questao)
    
    with open(CAMINHO_JSON, 'w', encoding='utf-8') as f:
        json.dump(banco, f, ensure_ascii=False, indent=2)

    print(f"✅ Questão [{nova_questao['id']}] cadastrada com sucesso no questoes.json!")

# ==============================================================================
# BASTA PREENCHER OS DADOS DA QUESTÃO ABAIXO E EXECUTAR O SCRIPT
# ==============================================================================
if __name__ == '__main__':
    adicionar_questao({
        "cargo": "Engenheiro(a) de Processamento",
        "ano": 2023,
        "disciplina": "Termodinâmica",
        "enunciado": "Em um processo isobárico envolvendo um gás ideal, o trabalho realizado pelo sistema é proporcional a:",
        "alternativas": [
            "A) Variação de temperatura do gás",
            "B) Razão entre pressão e volume final",
            "C) Variação nula de volume",
            "D) Energia interna em processo isotérmico",
            "E) Entalpia específica constante"
        ],
        "respostaCorreta": "A) Variação de temperatura do gás",
        "explicacao": "Para um gás ideal sob pressão constante (isobárico), W = P * ΔV = n * R * ΔT. Portanto, o trabalho é diretamente proporcional à variação de temperatura.",
        "fonteLink": "https://www.cesgranrio.org.br/"
    })