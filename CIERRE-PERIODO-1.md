# Cierre Período 1 — Análisis Patrimonial

**Período:** inicio de operación → 12/09/2026 13:58 (~3,5 meses)
**Liquidación:** `8dcbdf86-16bd-4bda-bdec-faa64e30ad73`
**Elaborado:** 14/09/2026

---

## 1. Resumen ejecutivo

El negocio generó **$3.472.886** de riqueza durante el período.

De ese total, **$1.856.000 (53%) se repartieron en efectivo** y **$1.616.886 (47%) quedaron
en inventario**, sin entrar en ningún cálculo del cierre.

> El modelo de cierre aplicado midió únicamente el efectivo. Casi la mitad del
> resultado del período quedó fuera de la ecuación.

---

## 2. Movimiento del período

| Concepto | Valor |
|---|---:|
| Ventas | $21.252.150 |
| Compras | $18.975.556 |
| Transporte | $584.000 |
| Deducciones (aseo, vencido, daño en transporte) | $221.500 |
| Colegio | $148.900 |
| **Inversiones** (compras + transporte) | **$19.559.556** |

**Nota metodológica:** las deducciones y el colegio **no restan del efectivo**. Son salidas
de mercadería, no de dinero. Su impacto ya está reflejado en que esa mercadería nunca
generó una venta. Restarlas del efectivo sería contarlas dos veces.

---

## 3. Control de caja

```
Efectivo esperado  =  Ventas − Compras − Transporte
                   =  $21.252.150 − $18.975.556 − $584.000
                   =  $1.692.594

Efectivo contado   =  $1.856.000
                      ───────────
Descuadre          =  +$163.406   (sobrante)
```

**Hipótesis del sobrante:** mercadería entregada y cobrada sin registrar la venta en el
sistema. El dinero entró a la caja y se contó; la venta nunca se cargó. Pendiente de
confirmar contra el saneamiento de inventario.

---

## 4. Modelo patrimonial

### Ecuación

```
Riqueza generada = (Inventario final + Efectivo final)
                 − (Inventario inicial + Efectivo inicial)
```

### Aplicación

| | |
|---|---:|
| Inventario final (a precio de venta) | $11.481.181 |
| Efectivo final | $1.856.000 |
| **Patrimonio final** | **$13.337.181** |
| | |
| Inventario inicial (a precio de venta) | $9.864.295 |
| Efectivo inicial | $0 |
| **Patrimonio inicial** | **$9.864.295** |
| | |
| **RIQUEZA GENERADA** | **$3.472.886** |

### Composición

| Componente | Valor | % |
|---|---:|---:|
| Efectivo generado | $1.856.000 | 53,4% |
| Crecimiento de inventario | $1.616.886 | 46,6% |
| **Total** | **$3.472.886** | **100%** |

### Ajuste a costo

Ambos inventarios están valuados a precio de venta al público, por lo que incluyen margen
todavía no realizado. Ajustado a costo (factor 84,13%, derivado del margen medido):

| | |
|---|---:|
| Inventario inicial a costo | $8.299.831 |
| Inventario final a costo | $9.659.118 |
| Crecimiento a costo | $1.359.287 |
| **Riqueza generada a costo** | **$3.215.287** |

---

## 5. Validación cruzada

Dos métodos independientes convergen:

| Método | Resultado |
|---|---:|
| Utilidad por márgenes de venta (extrapolada) | $3.367.664 |
| **Variación patrimonial** | **$3.472.886** |
| **Diferencia** | **$105.222 (3,0%)** |

Una diferencia del 3% entre dos caminos que no comparten supuestos es una señal fuerte de
consistencia contable.

**Rango de ganancia del período: $3,2M – $3,5M.**

### Sobre la utilidad medida

| | |
|---|---:|
| Utilidad **documentada** | $2.379.073 |
| Cobertura (ventas con costo conocido) | ~70,5% |
| Utilidad extrapolada al 100% | $3.367.664 |

La utilidad se calcula solo sobre las ventas cuyo costo de compra es conocido. El 29,5%
restante corresponde a productos cargados en el inventario inicial de junio, sin factura
de compra. No se les asigna costo ficticio: quedan fuera del cálculo y se declara el
alcance.

Esa cobertura crece sola a medida que se registran compras: pasó de **1,7% en junio** a
**91,3% en septiembre**.

---

## 6. Reparto efectivo del período

| Destino | Efectivo | Inventario | Total | % |
|---|---:|---:|---:|---:|
| Encargado (salario) | $1.499.089 | — | $1.499.089 | **43,2%** |
| Propietarios | $356.911 | $1.616.886 | $1.973.797 | **56,8%** |
| **Total** | **$1.856.000** | **$1.616.886** | **$3.472.886** | 100% |

### Cómo se calculó el salario

```
Base    = Efectivo contado + Inversiones
        = $1.856.000 + $19.559.556
        = $21.415.556

Salario = Base × 7%
        = $1.499.089
```

**Observación:** cuando se usa el efectivo *estimado* en lugar del contado, esa fórmula se
cancela algebraicamente y la base equivale exactamente a las ventas brutas:

```
(Ventas − Compras − Transporte) + (Compras + Transporte) = Ventas
```

En este cierre no ocurrió porque se contó la caja físicamente. El conteo de caja es lo que
activa el mecanismo de control de la fórmula.

---

## 7. Puntos de atención

### 7.1 El porcentaje del salario nunca se configuró

El 7% aplicado es el **valor por defecto del sistema**, no un parámetro elegido. La clave
`salario_pct` no existe en la configuración de la aplicación.

> **Resuelto (28/09/2026):** el 7% queda confirmado como porcentaje elegido para el
> Período 2. No hace falta cargarlo en Ajustes: es el valor por defecto del sistema y
> cada liquidación guarda en su snapshot el porcentaje aplicado.

### 7.2 El crecimiento del inventario no se remuneró

$1.616.886 de valor generado —el 46,6% del resultado— no participó de ningún cálculo de
salario ni de reparto explícito. Quedó íntegramente del lado de los propietarios.

### 7.3 El efectivo como medida es incompleto

El efectivo disponible al cierre depende de cuándo se hicieron las últimas compras. Un
período que cierra con reposición fuerte muestra poco efectivo sin que eso signifique menor
desempeño. Medir solo la caja penaliza la decisión de dejar la tienda bien surtida.

### 7.4 Sobrante de caja sin explicar

Los $163.406 de diferencia entre efectivo esperado y contado siguen pendientes de
conciliación. Se resolverá con el saneamiento de inventario.

---

## 8. Propuesta para el Período 2

> **Decisión (28/09/2026): no se adopta para el salario.** El Período 2 mantiene el
> modelo de liquidación por ventas con el 7% (ver §6). Esta sección queda como
> referencia del análisis.

Incorporar el patrimonio al cierre, sin reemplazar los controles actuales:

```
1. Patrimonio inicial  = Inventario inicial + Efectivo inicial
2. Patrimonio final    = Inventario final   + Efectivo final
3. Riqueza generada    = (2) − (1)
4. Control de caja     = Efectivo contado − (Ventas − Compras − Transporte)
5. Salario             = fórmula acordada sobre (3)
```

### Ancla del Período 2

| | |
|---|---:|
| Inventario base (cierre P1) | $11.481.181 |
| Efectivo inicial | $0 |
| **Patrimonio inicial P2** | **$11.481.181** |

### Sobre el porcentaje

Al cambiar la base de cálculo **no se puede conservar el mismo porcentaje**:

| Base | 7% arroja |
|---|---:|
| Ventas (modelo actual) | $1.499.089 |
| Riqueza generada | $243.102 |

Para mantener el salario en el nivel actual, el porcentaje sobre riqueza debería ser
**~43%**. Cualquier modelo nuevo requiere recalibrar el porcentaje, no solo cambiar la base.

### Restricción de liquidez

Parte de la riqueza está en mercadería, no en caja. Un salario calculado sobre la riqueza
total puede superar el efectivo disponible. Todo modelo nuevo debe contemplar un tope de
caja o un componente diferido.

---

## 9. Ajuste de inventario posterior al cierre

Con fecha **14/09/2026**, posterior al cierre, se registran ajustes de inventario para
corregir diferencias físicas acumuladas **antes** de esta liquidación:

- Mercadería entregada y cobrada sin registrar la venta (ya contabilizada en el efectivo
  contado de $1.856.000).
- Errores de conteo en la carga inicial y en el registro de compras.

**Estos ajustes no modifican el cierre del Período 1.** El inventario de $11.481.181 quedó
congelado en el snapshot de la liquidación.

Sí afectan el inventario corriente y, por lo tanto, el patrimonio inicial efectivo del
Período 2. La variación resultante **corresponde a corrección de registros históricos, no a
consumo del Período 2**, y debe descontarse al evaluar el desempeño del próximo cierre.

| | |
|---|---:|
| Productos ajustados | _(completar)_ |
| Valor neto del ajuste | _(completar)_ |
| Faltantes a precio de venta | _(completar)_ |

---

## 10. Nota sobre las fuentes

- Las cifras de **ventas, compras, transporte, deducciones, colegio, efectivo, salario e
  inventario** provienen del snapshot de la liquidación, calculado sobre la base local del
  dispositivo. Son las cifras autoritativas.
- Las cifras de **cobertura (70,5%) y utilidad extrapolada** se calcularon sobre el respaldo
  en la nube, que al momento del cálculo estaba incompleto (faltaban $45.000 en compras y
  $29.700 en ventas). Son aproximaciones con un margen de error inferior al 0,5%.
- El **inventario inicial de $9.864.295** fue aportado por el encargado, valuado a precio de
  venta al público.
- El **efectivo inicial de $0** fue confirmado por el encargado.
