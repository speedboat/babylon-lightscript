match x:
  // | [ a, b ] and a > 1: a + b
  | [ a, b ]: a - b
  | [ a, b = 2 ]: a + b - 2
  | [ a, ...b ]: b.concat(a)
  | [
      [
        b
        d = 'e'
      ]
      [ g, , h ]
      ...j
  ]:
    [b, d, g, ...j].join('')
