match x:
  | not: true
  | !!: true
  | not < 3: true
  | not + 1: true
  | ! ~f(): true
  | not .prop: true
  | not or not not and not: true
  | ! or !! and !: true
