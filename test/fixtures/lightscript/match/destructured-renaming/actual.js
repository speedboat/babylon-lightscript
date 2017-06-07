match x:
  | .a with { a, b = 1 }: a + b
  | .0 and .1 with [ a, b ]: a + b
