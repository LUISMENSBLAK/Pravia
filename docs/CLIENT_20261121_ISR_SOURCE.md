# Fuente contractual del cliente — 21 noviembre 2026

Copia íntegra del adjunto para continuidad del lote. Es una especificación funcional, no un skill instalado ni autorización para inventar hechos jurídicos o fiscales. Estado de implementación: consultar CLIENT_UPDATES_20261121.md.

# PRAVIA OS — CALCULADOR DE ISR EN ENAJENACIÓN DE INMUEBLES

## 1. QUÉ QUEREMOS LOGRAR

El módulo de ISR de PRAVIA no debe ser simplemente una calculadora llena de campos fiscales.

La intención es que el usuario pueda llegar a un cálculo correcto con la **menor captura manual posible**, pero que el sistema tenga detrás toda la profundidad necesaria para resolver operaciones sencillas y complejas.

El principio es:

**PRAVIA DEBE PREGUNTAR SÓLO LO QUE NECESITA PARA ESE CASO.**

No debe mostrar desde el inicio todos los posibles campos fiscales.

Si la operación es únicamente la venta de un terreno, el usuario no debería ver campos de construcción, mejoras, división terreno/construcción, avalúo referido, uso mixto, capas múltiples de adquisición, etc.

Si posteriormente el usuario selecciona un supuesto que sí requiere esos datos, entonces PRAVIA despliega los campos adicionales.

El sistema debe poder trabajar tanto con cálculos derivados de un expediente existente como con cálculos completamente independientes.

---

# 2. DOS FORMAS DE INICIAR UN CÁLCULO

Al entrar al módulo, el usuario puede comenzar de dos maneras:

### DESDE UN EXPEDIENTE

PRAVIA ya conoce gran parte de la información.

Debe intentar recuperar automáticamente:

- inmueble;
- antecedentes;
- comparecientes;
- porcentajes de propiedad;
- fechas conocidas;
- valores conocidos;
- nacionalidad;
- residencia fiscal;
- RFC;
- CURP;
- documentación disponible.

El usuario solamente completa o corrige lo que sea necesario para el cálculo fiscal.

### CÁLCULO INDEPENDIENTE

No existe obligación de que el ISR esté ligado a un expediente.

El usuario puede iniciar un cálculo nuevo y:

**SUBIR DOCUMENTACIÓN**

por ejemplo:

- antecedente;
- escritura de adquisición;
- avalúo;
- predial;
- documentos fiscales;
- cualquier documento relacionado con el inmueble.

También puede seleccionar comparecientes que ya existan en PRAVIA.

Si JOSÉ MANUEL RUIZ RODRÍGUEZ ya existe en el catálogo principal de comparecientes, no debe volver a capturarse toda su información.

PRAVIA recupera sus datos y únicamente solicita los faltantes necesarios para el cálculo.

---

# 3. UNA FORMA MUY RÁPIDA DE CAPTURAR: “DESCRIBE LA OPERACIÓN”

Además del formulario tradicional, el módulo debe ofrecer una entrada sencilla mediante lenguaje natural.

Ejemplo:

> JOSÉ MANUEL ADQUIRIÓ EL TERRENO EL 26 DE MAYO DE 2025 EN $2,034.65. LO VENDE EL 11 DE NOVIEMBRE DE 2026 EN $746,130. EL AVALÚO TAMBIÉN ES DE $746,130. VENDE EL 100% A ARACELI PEÑA GUTIÉRREZ. NO HAY MEJORAS NI DEDUCCIONES.

PRAVIA interpreta este texto y propone automáticamente:

| DATO | VALOR |
|---|---|
| Tipo de cálculo | SOLO TERRENO |
| Fecha adquisición | 26/05/2025 |
| Valor adquisición | $2,034.65 |
| Fecha enajenación | 11/11/2026 |
| Valor enajenación | $746,130.00 |
| Valor avalúo | $746,130.00 |
| Enajenante | JOSÉ MANUEL RUIZ RODRÍGUEZ |
| Porcentaje enajenado | 100% |
| Adquirente | ARACELI PEÑA GUTIÉRREZ |
| Porcentaje adquirido | 100% |
| Mejoras | NO |
| Deducciones | NO |

El usuario revisa la información y confirma.

### IMPORTANTE

La IA **NO CALCULA EL ISR**.

La IA únicamente ayuda a interpretar:

**texto + documentos + información existente en PRAVIA**

y convertirlo en datos estructurados.

Después de la confirmación del usuario:

**EL MOTOR FISCAL DETERMINÍSTICO REALIZA EL CÁLCULO.**

Es decir:

**IA INTERPRETA → USUARIO VALIDA → MOTOR FISCAL CALCULA**

---

# 4. ASPECTO GENERAL DE LA PANTALLA

La pantalla debe sentirse más como una hoja de trabajo inteligente que como un formulario gubernamental.

Una representación aproximada sería:

```text
┌───────────────────────────────────────────────────────────────────────┐
│ CALCULADOR DE ISR                                      CÁLCULO #001 │
│                                                                       │
│ [ DESDE EXPEDIENTE ]        [ CÁLCULO INDEPENDIENTE ]                │
└───────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────────┐
│ DESCRIBE LA OPERACIÓN                                                 │
│                                                                       │
│ José Manuel adquirió el terreno el 26 de mayo de 2025...             │
│                                                                       │
│                                      [ INTERPRETAR CON PRAVIA ]       │
└───────────────────────────────────────────────────────────────────────┘


TIPO DE CÁLCULO

[ ● SOLO TERRENO ]
[   TERRENO + CONSTRUCCIÓN · MISMA FECHA ]
[   TERRENO + CONSTRUCCIÓN · FECHAS DIFERENTES ]
[   OTROS SUPUESTOS ]


┌─────────────────────────────┬─────────────────────────────────────────┐
│       ADQUISICIÓN           │             ENAJENACIÓN                │
├─────────────────────────────┼─────────────────────────────────────────┤
│ Fecha: 26/05/2025           │ Fecha: 11/11/2026                     │
│                             │                                         │
│ Valor: $2,034.65            │ Precio: $746,130.00                   │
│                             │                                         │
│ Terreno: $2,034.65          │ Avalúo: $746,130.00                   │
│                             │                                         │
│ Construcción: NO APLICA     │ Terreno: $746,130.00                  │
└─────────────────────────────┴─────────────────────────────────────────┘


MÉTODO DE ACTUALIZACIÓN

[ ● AUTOMÁTICO · MEJOR RESULTADO ]
[   ACTUALIZACIÓN POR INPC ]
[   TABLA DE FACTORES RMF · ANEXO 9 ]  ⓘ


PARTES

JOSÉ MANUEL RUIZ RODRÍGUEZ                  ENAJENA 100%
ARACELI PEÑA GUTIÉRREZ                      ADQUIERE 100%


MEJORAS Y DEDUCCIONES

SIN MEJORAS REGISTRADAS
SIN DEDUCCIONES REGISTRADAS

[ + AGREGAR MEJORA ]       [ + AGREGAR DEDUCCIÓN ]


────────────────────────────────────────────────────────────────────────

RESULTADO

GANANCIA FISCAL                          $671,517.00
ISR DETERMINADO                          $126,288.13
PAGO ENTIDAD FEDERATIVA                   $33,575.85
REMANENTE FEDERAL                         $92,712.28

[ VER HOJA DE TRABAJO ]
```

Ésta no pretende ser la interfaz gráfica final. Sirve para mostrar la lógica visual que se busca.

---

# 5. ADQUISICIÓN Y ENAJENACIÓN DEBEN VERSE JUNTAS

Ésta es una regla importante de diseño.

Los valores de adquisición y enajenación no deben estar separados en pasos distantes.

El usuario debe poder comparar inmediatamente:

**DE DÓNDE VIENE EL INMUEBLE**

contra

**EN CUÁNTO SE ESTÁ ENAJENANDO.**

Por eso ambos bloques deben estar visualmente próximos, idealmente uno junto al otro.

---

# 6. TIPO DE CÁLCULO

PRAVIA debe definir primero el escenario fiscal.

Los principales serían:

| TIPO | COMPORTAMIENTO |
|---|---|
| SOLO TERRENO | No muestra campos de construcción |
| TERRENO + CONSTRUCCIÓN · MISMA FECHA | Una fecha de adquisición; separación terreno/construcción |
| TERRENO + CONSTRUCCIÓN · FECHAS DIFERENTES | Maneja fecha y costo por separado para terreno y construcción |
| VENTA PARCIAL | Abre datos adicionales de la porción transmitida |
| ADQUISICIÓN | Permite calcular exclusivamente ISR del adquirente cuando corresponda |
| OTRO SUPUESTO ESPECIAL | Abre únicamente los datos particulares necesarios |

Los primeros tres son los escenarios ordinarios y deben ser especialmente rápidos.

---

# 7. TERRENO + CONSTRUCCIÓN Y REGLA 80/20

Cuando existe terreno y construcción, PRAVIA debe conocer cuánto corresponde a cada componente.

La separación puede provenir de:

**ESCRITURA / ANTECEDENTE**

**AVALÚO DE ADQUISICIÓN**

**VALORES CATASTRALES**

o, cuando no exista una separación disponible:

**REGLA SUPLETORIA 20% TERRENO / 80% CONSTRUCCIÓN**

Por ejemplo, si el costo histórico fue:

**$1,000,000**

y corresponde aplicar la regla 20/80:

**TERRENO: $200,000**

**CONSTRUCCIÓN: $800,000**

El usuario no debe capturar ambos importes manualmente.

Selecciona la forma de separación y PRAVIA los calcula.

---

# 8. MÉTODO DE ACTUALIZACIÓN

No mostrar únicamente la expresión “ANEXO 9”, porque no es suficientemente clara para el usuario.

Mostrar:

### AUTOMÁTICO · MEJOR RESULTADO

PRAVIA calcula las alternativas permitidas y utiliza la que resulte fiscalmente más conveniente.

### ACTUALIZACIÓN POR INPC

Aplicación del procedimiento basado en índices de precios.

### TABLA DE FACTORES RMF · ANEXO 9

Debe existir un pequeño botón informativo:

**ⓘ**

que explique brevemente:

> Factores opcionales publicados en la Resolución Miscelánea Fiscal para la actualización de deducciones en enajenación de inmuebles.

El comportamiento predeterminado puede ser:

**AUTOMÁTICO · MEJOR RESULTADO**

---

# 9. CAPAS DE ADQUISICIÓN

PRAVIA debe ser capaz de manejar adquisiciones complejas, pero sin mostrarlas cuando no son necesarias.

Ejemplo complejo:

Una persona adquirió:

50% en 2005\
25% en 2015\
25% en 2020

Ahí existen varias fechas, costos y porcentajes.

PRAVIA puede tratar cada adquisición como una capa.

Sin embargo, si una persona adquirió:

100% el 26/05/2025

el usuario NO necesita ver un sistema de “capas”.

PRAVIA crea internamente una sola capa y muestra una adquisición normal.

La complejidad aparece sólo cuando existe.

---

# 10. AVALÚO REFERIDO

No debe existir siempre un botón llamado “AVALÚO REFERIDO” sin contexto.

Debe aparecer únicamente cuando el supuesto fiscal lo requiera.

Por ejemplo:

Existe una construcción o mejora cuyo costo no puede acreditarse documentalmente.

PRAVIA puede indicar:

```text
NO SE IDENTIFICÓ COSTO COMPROBABLE PARA ESTA CONSTRUCCIÓN.

¿CUENTA CON AVALÚO REFERIDO A LA FECHA CORRESPONDIENTE?

[ SÍ ]     [ NO ]
```

Si el usuario selecciona SÍ, entonces aparecen los campos necesarios:

**FECHA A LA QUE SE REFIERE EL AVALÚO**

**VALOR**

**DOCUMENTO**

El motor posteriormente aplica el tratamiento fiscal correspondiente.

Es decir:

**NO MOSTRAR LA HERRAMIENTA HASTA QUE SEA NECESARIA.**

---

# 11. VENTA PARCIAL

Debe funcionar igual.

No mostrar siempre todos los campos.

El usuario activa:

**VENTA PARCIAL**

y entonces PRAVIA pregunta lo necesario.

Por ejemplo:

```text
SUPERFICIE TOTAL:             1,000.00 m²
SUPERFICIE ENAJENADA:           300.00 m²
PROPORCIÓN TRANSMITIDA:           30.00%
```

o el porcentaje de derecho transmitido, dependiendo del supuesto.

El motor distribuye los costos y deducciones que correspondan.

---

# 12. USO MIXTO / PORCIÓN COMERCIAL

Cuando exista una propiedad que tenga componentes con tratamientos diferentes, PRAVIA puede activar:

**USO MIXTO / PORCIÓN COMERCIAL**

Pero solamente cuando corresponda.

Nunca debe mostrarse esta opción en una simple venta de terreno si no tiene relación con el cálculo.

---

# 13. ENAJENANTES Y ADQUIRENTES

El módulo ISR no debe convertirse en otro módulo de captura de personas.

PRAVIA ya tiene Comparecientes.

Por lo tanto, al seleccionar una persona existente, deben recuperarse automáticamente los datos que ya conozca.

En ISR se pide únicamente información faltante o particular de la operación.

Ejemplo:

```text
JOSÉ MANUEL RUIZ RODRÍGUEZ

PERSONA FÍSICA            ✓
RFC                       ✓
CURP                      ✓
NACIONALIDAD              ✓
RESIDENCIA FISCAL         ✓

PORCENTAJE QUE ENAJENA:   100%
```

No pedir nuevamente cinco datos que PRAVIA ya tiene.

---

# 14. RESIDENTES EN EL EXTRANJERO

Las opciones relacionadas con residentes en el extranjero no deben aparecer siempre.

Sólo cuando la residencia fiscal del enajenante haga pertinente ese tratamiento.

Entonces PRAVIA puede abrir las alternativas fiscales correspondientes, por ejemplo:

```text
TRATAMIENTO DEL ENAJENANTE

RESIDENTE FISCAL EN EL EXTRANJERO

MÉTODO DE CÁLCULO

( ) 25% SOBRE INGRESO BRUTO
( ) OPCIÓN SOBRE GANANCIA A TASA MÁXIMA
```

El módulo debe mostrar estas opciones únicamente cuando el supuesto fiscal las haga aplicables.

---

# 15. ISR DEL ADQUIRENTE

PRAVIA debe analizar automáticamente la relación entre:

**PRECIO DE ENAJENACIÓN**

y

**VALOR DE AVALÚO.**

Cuando esa comparación genere un posible supuesto de ingreso por adquisición, el sistema debe detectarlo.

No obligar al usuario a descubrirlo manualmente.

Ejemplo visual:

```text
⚠ POSIBLE ISR POR ADQUISICIÓN

EL VALOR DE AVALÚO SUPERA EL PRECIO DE ENAJENACIÓN
EN EL PORCENTAJE FISCALMENTE RELEVANTE.

DIFERENCIA: $________
ISR ESTIMADO: $________

[ VER CÁLCULO ]
```

---

# 16. EXENCIONES

No queremos que el abogado tenga que redactar una explicación jurídica cada vez que pretende aplicar una exención.

PRAVIA debe utilizar la información ya conocida para detectar posibilidades.

Ejemplo:

```text
TRATAMIENTO PROPUESTO

EXENTO · CASA HABITACIÓN

PRAVIA DETECTÓ INFORMACIÓN COMPATIBLE
CON ESTE TRATAMIENTO.

[ CONFIRMAR ]       [ CAMBIAR ]
```

O:

```text
POSIBLE EXENCIÓN
PRIMERA TRANSMISIÓN EJIDAL / COMUNAL

FALTA ACREDITAR:
• DOCUMENTO X

[ REVISAR ]
```

La idea es:

**PRAVIA PROPONE.**

**EL ABOGADO CONFIRMA.**

Sólo se solicita información adicional cuando realmente haga falta.

---

# 17. MEJORAS

El usuario puede agregar mejoras cuando existan.

Ejemplo:

```text
MEJORA

CONCEPTO:                ALBERCA
FECHA:                   15/06/2019
IMPORTE:                 $200,000
COMPONENTE:              CONSTRUCCIÓN
FUENTE:                  CFDI / DOCUMENTO / AVALÚO REFERIDO
```

PRAVIA determina automáticamente si el concepto pertenece a terreno, construcción o ambos según el escenario y la información disponible.

No mostrar opciones imposibles.

Por ejemplo:

si el cálculo es **SOLO TERRENO**, no tiene sentido presentar constantemente:

**TERRENO / CONSTRUCCIÓN / AMBOS.**

---

# 18. DEDUCCIONES

Funcionan de manera similar.

Ejemplo:

```text
COMISIÓN INMOBILIARIA
$100,000
```

Si el cálculo requiere distribuir esa deducción entre terreno y construcción y PRAVIA ya conoce la proporción, debe hacerlo automáticamente.

El usuario no debería tener que calcular y escribir:

$20,000 terreno\
$80,000 construcción

si el sistema ya conoce la división.

---

# 19. ACTUALIZACIÓN Y RECARGOS

Los recargos no deben mezclarse con el cálculo original.

Primero se determina:

**ISR ORIGINAL DE LA OPERACIÓN**

Posteriormente puede existir:

### CALCULAR ACTUALIZACIÓN Y RECARGOS

El usuario selecciona una fecha hipotética de pago:

```text
¿CUÁNTO SE PAGARÍA SI SE ENTERA EL:

15/02/2027 ?

[ CALCULAR ]
```

PRAVIA muestra actualización, recargos y total estimado a esa fecha.

Esto no modifica el cálculo original.

---

# 20. RESULTADO

El resultado no debe ser únicamente un número final.

Debe mostrar un resumen entendible.

Ejemplo real:

### DATOS

Adquisición: 26/05/2025\
Costo histórico: $2,034.65

Enajenación: 11/11/2026\
Precio: $746,130.00\
Avalúo: $746,130.00

### CÁLCULO

El costo actualizado ordinario resulta inferior al costo mínimo fiscal aplicable.

Costo mínimo utilizado:

**10% × $746,130 = $74,613.00**

Ganancia:

**$746,130 − $74,613 = $671,517.00**

ISR provisional:

**$126,288.13**

Pago correspondiente a entidad federativa:

**$33,575.85**

Remanente federal:

**$92,712.28**

---

# 21. HOJA DE TRABAJO

Todo cálculo debe poder abrir una:

### HOJA DE TRABAJO

Ahí sí puede mostrarse el detalle técnico completo.

Debe contener, cuando corresponda:

- valores utilizados;
- valores descartados;
- INPC;
- factores;
- años transcurridos;
- depreciaciones;
- actualizaciones;
- separación terreno/construcción;
- deducciones;
- ganancias;
- tarifas;
- límites;
- cuotas fijas;
- porcentajes;
- ISR determinado;
- acreditamientos;
- ISR estatal/federal;
- fundamentos fiscales utilizados.

La pantalla principal debe permanecer sencilla.

La hoja de trabajo puede ser profunda.

---

# 22. PRINCIPIO GENERAL DE LA INTERFAZ

La interfaz debe comportarse de forma progresiva.

Algo parecido a:

```text
SOLO TERRENO
      │
      ├── adquisición
      ├── enajenación
      ├── partes
      └── resultado


TERRENO + CONSTRUCCIÓN
      │
      ├── adquisición
      │       └── separación terreno/construcción
      ├── enajenación
      ├── partes
      ├── mejoras/deducciones
      └── resultado


SI ACTIVA VENTA PARCIAL
      │
      └── aparecen campos de porción transmitida


SI DETECTA RESIDENTE EN EL EXTRANJERO
      │
      └── aparecen opciones fiscales específicas


SI NO EXISTE COSTO COMPROBABLE DE CONSTRUCCIÓN
      │
      └── aparece opción de avalúo referido


SI AVALÚO DISPARA ISR DE ADQUISICIÓN
      │
      └── PRAVIA LO ADVIERTE AUTOMÁTICAMENTE
```

La regla debe ser:

**UN CAMPO NO APARECE PORQUE PODRÍA EXISTIR.**

**APARECE PORQUE EL CASO ACTUAL LO NECESITA.**

---

# 23. QUÉ DEBE HACER PRAVIA AUTOMÁTICAMENTE

PRAVIA debe intentar encargarse de la mayor cantidad posible del trabajo repetitivo:

**DATOS YA EXISTENTES → PRECARGAR**

**DOCUMENTOS → EXTRAER**

**TEXTO LIBRE → INTERPRETAR**

**PROPORCIONES CALCULABLES → CALCULAR**

**TRATAMIENTOS POSIBLES → PROPONER**

**SUPUESTOS ESPECIALES → DETECTAR**

**CÁLCULO FISCAL → MOTOR DE REGLAS**

**RESULTADO → EXPLICAR**

El abogado debe principalmente:

**REVISAR, COMPLETAR LO QUE FALTE Y CONFIRMAR.**

---

# 24. QUÉ NO QUEREMOS

No queremos un formulario en el que para calcular una venta sencilla de terreno el usuario tenga que llenar:

residencia fiscal, capas, fechas repetidas, componente terreno, componente construcción, IVA, porcentaje comercial, avalúo referido, método extranjero, mejoras y opciones que ni siquiera aplican.

Tampoco queremos que la IA invente un ISR.

La IA es una herramienta de captura e interpretación.

La determinación fiscal debe provenir de un motor de reglas estructurado, verificable y versionado.

---

# 25. EXPERIENCIA QUE BUSCAMOS

En una operación sencilla, el usuario debería poder hacer esto:

```text
1. ABRIR CALCULADOR ISR

2. PEGAR:
   “TERRENO ADQUIRIDO EN 2025 POR $2,034.65,
    VENTA EN 2026 POR $746,130...”

3. PRAVIA INTERPRETA LOS DATOS

4. USUARIO CONFIRMA

5. PRAVIA CALCULA

6. RESULTADO:
   $126,288.13

7. SI QUIERE SABER CÓMO LLEGÓ:
   [ VER HOJA DE TRABAJO ]
```

Una operación sencilla debe sentirse sencilla.

Una operación compleja debe poder resolverse sin que PRAVIA se quede corto.

Ése es el objetivo del módulo.
