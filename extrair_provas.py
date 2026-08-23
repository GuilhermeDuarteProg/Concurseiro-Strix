import json
import os
import re
import pdfplumber

PASTA_PROVAS = "provas"
CAMINHO_JSON = "questoes.json"

MATERIAS_CONHECIDAS = {
    "LÍNGUA PORTUGUESA": "Português",
    "PORTUGUÊS": "Português",
    "LÍNGUA INGLESA": "Língua Inglesa",
    "INGLÊS": "Língua Inglesa",
    "RACIOCÍNIO LÓGICO": "RLM",
    "INFORMÁTICA": "Informática",
    "CONHECIMENTOS ESPECÍFICOS": "Conhecimentos Específicos",
    "DIREITO CONSTITUCIONAL": "Direito Constitucional",
    "DIREITO ADMINISTRATIVO": "Direito Administrativo",
}


def extrair_texto_e_tabelas(caminho_pdf):
    texto_completo = ""
    with pdfplumber.open(caminho_pdf) as pdf:
        for i, pagina in enumerate(pdf.pages):
            if i == 0:
                continue
            largura, altura = pagina.width, pagina.height
            coluna_esquerda = pagina.crop((0, 0, largura / 2, altura))
            coluna_direita = pagina.crop((largura / 2, 0, largura, altura))

            txt_esq = coluna_esquerda.extract_text() or ""
            txt_dir = coluna_direita.extract_text() or ""
            texto_completo += txt_esq + "\n" + txt_dir + "\n"
    return texto_completo


def limpar_texto(texto):
    texto = re.sub(r"(\b\w+)-\s+(\w+\b)", r"\1\2", texto)
    texto = re.sub(r"www\.pciconcursos\.com\.br", "", texto)
    texto = re.sub(r"TRANSPETRO[^\n]*PROVA\s+\d+", "", texto)
    texto = re.sub(r"\(cid:\d+\)", "", texto)
    return texto


def processar_pdf(caminho_pdf, id_inicial):
    texto = extrair_texto_e_tabelas(caminho_pdf)
    texto = limpar_texto(texto)

    blocos = re.split(r"\n(?=\d{1,2}\s*\n|TEXT[O]?\s+[I|V|X\d]+)", texto)
    questoes = []
    id_atual = id_inicial
    materia_atual = "Conhecimentos Específicos"
    texto_base_atual = ""

    for bloco in blocos:
        bloco_clean = bloco.strip()

        if re.search(
            r"^(TEXTO?\s+[I|V|X\d]+|Read the text|Leia o texto)",
            bloco_clean,
            re.IGNORECASE,
        ):
            texto_base_atual = "\n".join(bloco_clean.split("\n"))
            continue

        for chave, nome_padrao in MATERIAS_CONHECIDAS.items():
            if chave in bloco_clean.upper():
                materia_atual = nome_padrao
                if "ESPECÍFICOS" in chave:
                    texto_base_atual = ""
                break

        linhas = [l.strip() for l in bloco_clean.split("\n") if l.strip()]
        if not linhas:
            continue

        if re.match(r"^\d{1,2}$", linhas[0]):
            numero = int(linhas[0])
            if numero < 1 or numero > 120:
                continue

            corpo = "\n".join(linhas[1:])
            partes_alts = re.split(r"\n(?=\([A-E]\)|[A-E]\))", corpo)
            enunciado_questao = partes_alts[0].strip()

            opcoes = [
                re.sub(r"^\([A-E]\)\s*|^[A-E]\)\s*", "", alt.strip())
                for alt in partes_alts[1:]
                if alt.strip()
            ]

            if len(enunciado_questao) > 5 and len(opcoes) >= 4:
                enunciado_final = enunciado_questao
                if texto_base_atual and (
                    "line" in enunciado_questao.lower()
                    or "linha" in enunciado_questao.lower()
                    or "texto" in enunciado_questao.lower()
                    or "text" in enunciado_questao.lower()
                    or numero <= 15
                ):
                    enunciado_final = (
                        f"--- TEXTO DE APOIO ---\n{texto_base_atual}\n\n---"
                        f" QUESTÃO ---\n{enunciado_questao}"
                    )

                nome_prova = os.path.basename(caminho_pdf).replace(".pdf", "")

                questoes.append(
                    {
                        "id": id_atual,
                        "numero": numero,
                        "banca": "CESGRANRIO",
                        "orgao": "Transpetro",
                        "prova": nome_prova,
                        "materia": materia_atual,
                        "disciplina": materia_atual,
                        "categoria": materia_atual,
                        "assunto": materia_atual,
                        "enunciado": enunciado_final,
                        "opcoes": opcoes,
                        "alternativas": opcoes,
                        "resposta": 0,
                    }
                )
                id_atual += 1

    return questoes


if __name__ == "__main__":
    todas_as_questoes = []
    id_global = 1

    for arquivo in os.listdir(PASTA_PROVAS):
        if arquivo.endswith(".pdf"):
            caminho_completo = os.path.join(PASTA_PROVAS, arquivo)
            print(f"Lendo prova: {arquivo}...")
            questoes_pdf = processar_pdf(caminho_completo, id_global)
            todas_as_questoes.extend(questoes_pdf)
            id_global += len(questoes_pdf)

    with open(CAMINHO_JSON, "w", encoding="utf-8") as f:
        json.dump(todas_as_questoes, f, ensure_ascii=False, indent=2)

    print(
        f"\nSucesso! {len(todas_as_questoes)} questões geradas em '{CAMINHO_JSON}'."
    )