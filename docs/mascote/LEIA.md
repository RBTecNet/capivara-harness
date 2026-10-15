# Mascote — variantes aprovadas

## Variante B (aprovada em 2026-10-14)

`variante-b-52x15.ans` — capivara do dashboard de referência, 52 colunas x 15
linhas, renderizada pelo chafa 1.18.1 com símbolos completos. Fica no topo da
lista.

Como refazer:

1. `variante-b-fonte.png` é o recorte (672,12)-(952,176) do PNG de referência.
2. Contraste x1.15, saturação x1.2 (Pillow `ImageEnhance`); pixel com
   `max(r,g,b) < 48 e b >= r` (o fundo azul-marinho) vira transparente →
   `variante-b-fonte-alpha.png`.
3. `chafa --format symbols --colors full --size 52x15 \
      --symbols all-wide-braille-ascii-legacy -t 0.5 --work 9 \
      --preprocess off --polite on variante-b-fonte-alpha.png`

Para ver: `cat variante-b-52x15.ans; printf '\033[0m\n'`

## Cabeça (aprovada em 2026-10-14)

`cabeca-40x18.ans` — cabeça de frente, 40 colunas x 18 linhas.

Como refazer:

1. `cabeca-fonte.jpeg` é a imagem original (585x524, fundo branco).
2. Flood fill do branco (`min(r,g,b) > 225`) a partir das bordas vira
   transparente — o branco dos olhos e dos dentes fica, porque não toca a
   borda. Recorte pelo bbox → `cabeca-fonte-alpha.png`.
3. `chafa --format symbols --colors full --size 40x40 \
      --symbols all-wide-braille-ascii-legacy -t 0.5 --work 9 \
      --preprocess off --polite on cabeca-fonte-alpha.png`

## Build — busto (aprovado em 2026-10-14)

`build-busto-40x13.ans` — capivara de capacete e chave, só o busto, 40 colunas
x 13 linhas. O corpo inteiro e as versões simplificadas por mediana ficaram
ruins: detalhe fino (bigode, dobras, marca d'água) vira ruído em poucas células.

ATENÇÃO: `build-fonte.jpeg` é prévia do Pngtree, com marca d'água. Antes de
embutir no produto, trocar pela versão licenciada (sem marca) e regerar.

Como refazer:

1. Flood fill do branco a partir das bordas vira transparente, recorte pelo
   bbox, e depois só os 52% de cima da altura → `build-busto-fonte-alpha.png`.
2. `chafa --format symbols --colors full --size 40x18 \
      --symbols all-wide-braille-ascii-legacy -t 0.5 --work 9 \
      --preprocess off --polite on build-busto-fonte-alpha.png`

## Init — cabeça de mascote (em teste desde 2026-10-14)

`init-cabeca-23x13.ans` — cabeça de frente, contorno preto grosso, 23 colunas x
13 linhas: a mesma altura do build. Substitui a variante B no `init` para
avaliação; a variante B continua aqui.

Como refazer:

1. `init-cabeca-fonte.jpeg` tem um xadrez de "transparência" desenhado no
   fundo (é JPEG, não tem alfa). Flood fill a partir das bordas do que é claro e
   sem cor (`min(r,g,b) > 170` e `max-min < 22`) vira transparente; o contorno
   preto segura o preenchimento. Recorte pelo bbox → `init-cabeca-fonte-alpha.png`.
2. `chafa --format symbols --colors full --size 60x13 \
      --symbols all-wide-braille-ascii-legacy -t 0.5 --work 9 \
      --preprocess off --polite on init-cabeca-fonte-alpha.png`

## Decisão (2026-10-14)

Todos os estágios usam `build-busto-40x13.ans`. A variante B e as cabeças
ficaram grandes demais no painel; reduzidas, e também a cabeça de contorno
grosso e o adesivo de capacete, ficaram ilegíveis. Os arquivos ficam aqui como
registro. Quem escolhe o desenho de cada estágio é `SOURCES` em
`packages/core/scripts/generate-mascots.mjs`.
