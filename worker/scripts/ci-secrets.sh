# Limpia los secretos de GitHub antes de publicar el servidor de voz.
# Corrige los errores al pegar: espacios en los extremos, comillas o la dirección completa.
# Rechaza los valores que no pueden servir, como una descripción en lugar del valor real.
# Uso: `source scripts/ci-secrets.sh`. Solo trata las variables definidas.
# Muestra todos los errores juntos y termina con error si hay alguno.
# GitHub ya oculta el valor original. Cada valor limpio se oculta con ::add-mask::.
# Los valores limpios nunca tienen saltos de línea: así la máscara los cubre enteros.
# Necesita Node.js: trata los espacios Unicode igual que la app.

ci_errors=0

ci_mask() {
  echo "::add-mask::$1"
}

ci_fail() {
  echo "::error title=$1::$2"
  ci_errors=$((ci_errors + 1))
}

ci_notice_if_changed() {
  if [ "$2" != "$3" ]; then
    echo "::notice title=$1 corregido::Se quitaron espacios, comillas o texto de más. Se usa solo el valor válido."
  fi
}

# Quita los espacios de los extremos, también los invisibles. Es el mismo `trim()` de la app.
ci_trim() {
  CI_TEXT="$1" node -e 'process.stdout.write(process.env.CI_TEXT.trim())'
}

# Quita los espacios de los extremos, los caracteres de ancho cero y las comillas.
ci_unwrap() {
  CI_TEXT="$1" node -e 'process.stdout.write(process.env.CI_TEXT.replace(/[​-‍⁠﻿"'"'"'`“”‘’«»]/g, "").trim())'
}

# Indica si el valor tiene espacios, también invisibles.
ci_has_spaces() {
  CI_TEXT="$1" node -e 'process.exit(/\s/.test(process.env.CI_TEXT) ? 0 : 1)'
}

# Indica si el valor tiene caracteres fuera del ASCII visible: no viajarían en una cabecera HTTP.
ci_has_non_ascii() {
  LC_ALL=C grep -q '[^!-~]' <<< "$1"
}

CI_DESCRIPTION="Tiene espacios en medio: parece una descripción, no el valor real."

ci_clean_account_id() {
  local raw="$CLOUDFLARE_ACCOUNT_ID" value hint
  # El ID de cuenta son 32 caracteres hexadecimales.
  # También sirve la dirección del panel de Cloudflare pegada entera.
  if ! [[ "$raw" =~ (^|[^0-9A-Za-z])([0-9a-fA-F]{32})([^0-9A-Za-z]|$) ]]; then
    value="$(ci_unwrap "$raw")"
    if [ -z "$value" ]; then
      hint="Está vacío."
    elif ci_has_spaces "$value"; then
      hint="$CI_DESCRIPTION"
    elif [[ "$value" == *@* ]]; then
      hint="Parece un correo electrónico."
    elif [[ "$value" == *[/.]* ]]; then
      hint="Parece una dirección web o un dominio."
    else
      hint="Tiene ${#value} caracteres."
    fi
    ci_fail "CLOUDFLARE_ACCOUNT_ID no es válido" "$hint El «Account ID» tiene 32 caracteres: números y letras de la a a la f. Cópialo de Cloudflare en Workers y Pages."
    return 0
  fi
  value="${BASH_REMATCH[2]}"
  ci_mask "$value"
  ci_notice_if_changed CLOUDFLARE_ACCOUNT_ID "$raw" "$value"
  export CLOUDFLARE_ACCOUNT_ID="$value"
}

ci_clean_api_token() {
  local raw="$CLOUDFLARE_API_TOKEN" value
  local howto="Guarda el token que Cloudflare muestra una sola vez al crearlo: unos 40 caracteres sin espacios."
  # También sirve el comando de prueba de Cloudflare pegado entero: «Bearer <token>».
  if [[ "$raw" =~ Bearer[^A-Za-z0-9_-]+([A-Za-z0-9_-]+) ]]; then
    value="${BASH_REMATCH[1]}"
  else
    value="$(ci_unwrap "$raw")"
  fi
  if [ -z "$value" ]; then
    ci_fail "CLOUDFLARE_API_TOKEN vacío" "$howto"
    return 0
  fi
  if ci_has_spaces "$value"; then
    ci_fail "CLOUDFLARE_API_TOKEN no es válido" "$CI_DESCRIPTION $howto"
    return 0
  fi
  if ci_has_non_ascii "$value"; then
    ci_fail "CLOUDFLARE_API_TOKEN no es válido" "Tiene letras con tilde o caracteres invisibles. $howto"
    return 0
  fi
  # Errores frecuentes: pegar la «Global API Key» o el «Account ID» en lugar del token.
  if [[ "$value" =~ ^[0-9a-fA-F]{37}$ ]]; then
    ci_fail "CLOUDFLARE_API_TOKEN es la Global API Key" "Ese valor no es un token. Crea un token con la plantilla «Edit Cloudflare Workers»."
    return 0
  fi
  if [[ "$value" =~ ^[0-9a-fA-F]{32}$ ]]; then
    ci_fail "CLOUDFLARE_API_TOKEN es un ID" "Ese valor parece el «Account ID». Crea un token con la plantilla «Edit Cloudflare Workers»."
    return 0
  fi
  if [ "${#value}" -lt 30 ]; then
    ci_fail "CLOUDFLARE_API_TOKEN no es válido" "Tiene ${#value} caracteres: es corto para un token. $howto"
    return 0
  fi
  ci_mask "$value"
  ci_notice_if_changed CLOUDFLARE_API_TOKEN "$raw" "$value"
  export CLOUDFLARE_API_TOKEN="$value"
}

ci_clean_google_key() {
  local raw="$GOOGLE_TTS_KEY" value
  local howto="Guarda la clave de API de Google Cloud: empieza por AIza y tiene 39 caracteres."
  # Las claves de API de Google empiezan por «AIza» y tienen 39 caracteres.
  if [[ "$raw" =~ (^|[^0-9A-Za-z_-])(AIza[0-9A-Za-z_-]{35})([^0-9A-Za-z_-]|$) ]]; then
    value="${BASH_REMATCH[2]}"
  else
    value="$(ci_unwrap "$raw")"
    if [ -z "$value" ]; then
      ci_fail "GOOGLE_TTS_KEY vacío" "$howto"
      return 0
    fi
    if ci_has_spaces "$value"; then
      ci_fail "GOOGLE_TTS_KEY no es válido" "$CI_DESCRIPTION $howto"
      return 0
    fi
    if ci_has_non_ascii "$value"; then
      ci_fail "GOOGLE_TTS_KEY no es válido" "Tiene letras con tilde o caracteres invisibles. $howto"
      return 0
    fi
    echo "::warning title=GOOGLE_TTS_KEY con formato inesperado::$howto Comprueba que copiaste la clave de API."
  fi
  ci_mask "$value"
  ci_notice_if_changed GOOGLE_TTS_KEY "$raw" "$value"
  export GOOGLE_TTS_KEY="$value"
}

ci_clean_app_token() {
  local raw="$APP_TOKEN" value
  local howto="Usa un código aleatorio de un generador de contraseñas: 16 caracteres o más, sin tildes ni eñes."
  # La app quita los espacios de los extremos del código. Aquí se hace lo mismo.
  value="$(ci_trim "$raw")"
  if [ -z "$value" ]; then
    ci_fail "APP_TOKEN vacío" "$howto"
    return 0
  fi
  # El navegador solo envía en una cabecera caracteres ASCII en una línea.
  if [[ "$value" == *$'\n'* ]] || LC_ALL=C grep -q '[^ -~]' <<< "$value"; then
    ci_fail "APP_TOKEN no es válido" "Tiene tildes, eñes, comillas tipográficas, espacios invisibles o varias líneas. ¿Guardaste una descripción en lugar del código? $howto"
    return 0
  fi
  ci_mask "$value"
  export APP_TOKEN="$value"
}

if [ -n "${CLOUDFLARE_ACCOUNT_ID+x}" ]; then ci_clean_account_id; fi
if [ -n "${CLOUDFLARE_API_TOKEN+x}" ]; then ci_clean_api_token; fi
if [ -n "${GOOGLE_TTS_KEY+x}" ]; then ci_clean_google_key; fi
if [ -n "${APP_TOKEN+x}" ]; then ci_clean_app_token; fi

if [ "$ci_errors" -gt 0 ]; then
  echo "::error title=Secretos por corregir::Guarda el valor real de cada secreto indicado en GitHub: Settings, Secrets and variables, Actions. Después ejecuta de nuevo la publicación."
  exit 1
fi
unset ci_errors
