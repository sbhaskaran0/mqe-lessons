---
type: interactive
summary: Saving rates of rich and poor country groups over time, with the crisis year marked.
domain: macroeconomics
illustrates: ["[[Toy Saving Rates]]", "[[Toy Growth Model]]"]
---
# Toy Saving Chart

## Spec

```yaml
type: data-chart
dataset: toy-saving-rates
mark: line
x: {column: year, label: Year}
y: {column: rate, label: Saving rate, tex: "s"}
series:
  - {id: rich, label: Rich countries, where: {group: rich}}
  - {id: poor, label: Poor countries, where: {group: poor}}
annotations:
  - {id: crisis, x: 2008, label: Crisis}
```
