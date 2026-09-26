// Written for compiler-tooling-lab: a deliberately contradictory constraint,
// used to capture a real schema-opt verifier diagnostic.
func.func @bad(%doc: !schema.value) -> i1 {
  %v = schema.validate_string %doc { min_length = 8 : i64, max_length = 3 : i64 } : !schema.value
  return %v : i1
}
