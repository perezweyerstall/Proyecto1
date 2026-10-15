# Limpia los secretos de GitHub antes de publicar el servidor de voz.
# Corrige los errores al pegar: espacios, espacios invisibles, comillas o texto de más.
# Uso: `source scripts/ci-secrets.sh`. Solo trata las variables definidas.
# GitHub ya oculta el valor original. Cada valor limpio se oculta con ::add-mask::.
# Los valores limpios nunca tienen saltos de línea: así la máscara los cubre enteros.
# Necesita Node.js: trata los espacios Unicode igual que la app.

ci_mask() {
  if [ -n "$1" ]; then echo "::add-mask::$1"; fi
}

ci_fail() {
  echo "::error title=$1::$2"
  exit 1
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

# Quita todos los espacios, los caracteres de ancho cero y las comillas.
ci_compact() {
  CI_TEXT="$1" node -e 'process.stdout.write(process.env.CI_TEXT.replace(/[\s​-‍⁠﻿"'"'"'`“”‘’«»]/g, ""))'
}

# Falla si queda algún carácter fuera del ASCII visible: no viajaría en una cabecera HTTP.
ci_require_ascii() {
  if LC_ALL=C grep -q '[^!-~]' <<< "$2"; then
    ci_fail "$1 no es válido" "Tiene letras con tilde, comillas tipográficas o espacios invisibles. Cópialo de nuevo y guárdalo en GitHub."
  fi
}

if [ -n "${CLOUDFLARE_ACCOUNT_ID+x}" ]; then
  ci_raw="$CLOUDFLARE_ACCOUNT_ID"
  # El ID de cuenta son 32 caracteres hexadecimales.
  # También sirve la dirección del panel de Cloudflare pegada entera.
  if [[ "$ci_raw" =~ (^|[^0-9A-Za-z])([0-9a-fA-F]{32})([^0-9A-Za-z]|$) ]]; then
    ci_value="${BASH_REMATCH[2]}"
  else
    ci_value="$(ci_compact "$ci_raw")"
  fi
  ci_mask "$ci_value"
  if [ -z "$ci_value" ]; then
    ci_fail "CLOUDFLARE_ACCOUNT_ID vacío" "Copia el «Account ID» de Cloudflare y guárdalo de nuevo en GitHub."
  fi
  if ! [[ "$ci_value" =~ ^[A-Za-z0-9_-]+$ ]]; then
    if [[ "$ci_raw" == *@* ]]; then
      ci_hint="Parece un correo electrónico."
    elif [[ "$ci_raw" == *[/.]* ]]; then
      ci_hint="Parece una dirección web o un dominio."
    else
      ci_hint="Tiene ${#ci_value} caracteres y alguno no es válido."
    fi
    ci_fail "CLOUDFLARE_ACCOUNT_ID no es válido" "$ci_hint El ID de cuenta son 32 letras y números. Cópialo de Cloudflare: «Account ID» en Workers y Pages. Guárdalo de nuevo en GitHub."
  fi
  ci_notice_if_changed CLOUDFLARE_ACCOUNT_ID "$ci_raw" "$ci_value"
  export CLOUDFLARE_ACCOUNT_ID="$ci_value"
fi

if [ -n "${CLOUDFLARE_API_TOKEN+x}" ]; then
  ci_raw="$CLOUDFLARE_API_TOKEN"
  # También sirve el comando de prueba de Cloudflare pegado entero: «Bearer <token>».
  if [[ "$ci_raw" =~ Bearer[^A-Za-z0-9_-]+([A-Za-z0-9_-]+) ]]; then
    ci_value="${BASH_REMATCH[1]}"
  else
    ci_value="$(ci_compact "$ci_raw")"
  fi
  ci_mask "$ci_value"
  if [ -z "$ci_value" ]; then
    ci_fail "CLOUDFLARE_API_TOKEN vacío" "Crea un token con la plantilla «Edit Cloudflare Workers» y guárdalo de nuevo en GitHub."
  fi
  ci_require_ascii CLOUDFLARE_API_TOKEN "$ci_value"
  # Errores frecuentes: pegar la «Global API Key» o el «Account ID» en lugar del token.
  if [[ "$ci_value" =~ ^[0-9a-fA-F]{37}$ ]]; then
    ci_fail "CLOUDFLARE_API_TOKEN es la Global API Key" "Ese valor no es un token. Crea un token con la plantilla «Edit Cloudflare Workers» y guárdalo en GitHub."
  fi
  if [[ "$ci_value" =~ ^[0-9a-fA-F]{32}$ ]]; then
    ci_fail "CLOUDFLARE_API_TOKEN es un ID" "Ese valor parece el «Account ID». Crea un token con la plantilla «Edit Cloudflare Workers» y guárdalo en GitHub."
  fi
  ci_notice_if_changed CLOUDFLARE_API_TOKEN "$ci_raw" "$ci_value"
  export CLOUDFLARE_API_TOKEN="$ci_value"
fi

if [ -n "${GOOGLE_TTS_KEY+x}" ]; then
  ci_raw="$GOOGLE_TTS_KEY"
  # Las claves de API de Google empiezan por «AIza» y tienen 39 caracteres.
  if [[ "$ci_raw" =~ (^|[^0-9A-Za-z_-])(AIza[0-9A-Za-z_-]{35})([^0-9A-Za-z_-]|$) ]]; then
    ci_value="${BASH_REMATCH[2]}"
  else
    ci_value="$(ci_compact "$ci_raw")"
    echo "::warning title=GOOGLE_TTS_KEY con formato inesperado::Las claves de API de Google empiezan por AIza y tienen 39 caracteres. Comprueba que copiaste la clave de API."
  fi
  ci_mask "$ci_value"
  if [ -z "$ci_value" ]; then
    ci_fail "GOOGLE_TTS_KEY vacío" "Copia la clave de API de Google Cloud y guárdala de nuevo en GitHub."
  fi
  ci_require_ascii GOOGLE_TTS_KEY "$ci_value"
  ci_notice_if_changed GOOGLE_TTS_KEY "$ci_raw" "$ci_value"
  export GOOGLE_TTS_KEY="$ci_value"
fi

if [ -n "${APP_TOKEN+x}" ]; then
  ci_raw="$APP_TOKEN"
  # La app quita los espacios de los extremos del código. Aquí se hace lo mismo.
  ci_value="$(ci_trim "$ci_raw")"
  if [ -z "$ci_value" ]; then
    ci_fail "APP_TOKEN vacío" "Genera un código largo y aleatorio y guárdalo de nuevo en GitHub."
  fi
  # El navegador solo envía en una cabecera caracteres ASCII en una línea.
  if [[ "$ci_value" == *$'\n'* ]] || LC_ALL=C grep -q '[^ -~]' <<< "$ci_value"; then
    ci_fail "APP_TOKEN no es válido" "Tiene letras con tilde, comillas tipográficas, espacios invisibles o varias líneas. Usa solo letras sin tilde, números y símbolos del teclado. Cámbialo en GitHub y en Ajustes de la app."
  fi
  ci_mask "$ci_value"
  export APP_TOKEN="$ci_value"
fi

unset ci_raw ci_value ci_hint
