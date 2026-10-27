# The subset of JSON Schema draft 2020-12 the shipped schemas use, for the guards. The same keywords,
# messages and paths as dw-sdlc/src/json-schema.ts; the tests run both copies against one case list.
# A keyword outside the subset is an error, never a silent pass. `format` is enforced: `regex` is
# the one format, tried as an Oniguruma expression and refused when it holds a construct POSIX ERE
# lacks, because `grep -E` runs the pattern and BSD and GNU grep read those differently.
#
# Usage: `jq -L <this dir> --slurpfile s schema.json 'include "schema"; validate($s[0])' doc.json`
# prints an array of {path, message}, empty when the document validates.

def _at($path): if $path == "" then "(root)" else $path end;
def _child($path; $key): if $path == "" then $key else "\($path).\($key)" end;
def _annotations: ["$schema", "$id", "$comment", "title", "description", "default", "examples"];

def _type_matches($t):
  if $t == "object" then type == "object"
  elif $t == "array" then type == "array"
  elif $t == "string" then type == "string"
  elif $t == "number" then type == "number"
  elif $t == "integer" then (if type == "number" then . == floor else false end)
  elif $t == "boolean" then type == "boolean"
  elif $t == "null" then type == "null"
  else error("unknown type \($t | tojson)") end;

def _is_regex: . as $re | (try ("" | test($re)) catch "bad") != "bad";

# The first `\d`, `\s`, `\w`, `\b`, capital twin or `(?` outside a bracket expression. The pattern is
# read token by token: a bracket expression, where `(`, `?` and a backslash are plain characters and a
# class such as `[:alpha:]` does not close it, an escape, a `(?`, or any one character.
def _not_ere:
  [match("\\[\\^?\\]?(?:\\[:[a-z]+:\\]|[^\\]])*\\]|\\\\[\\s\\S]|\\(\\?|[\\s\\S]"; "g").string
    | select(test("^(\\\\[dDsSwWbB]|\\(\\?)$"))][0];

def _problem($path; $message): {path: $path, message: $message};

def _check($schema; $path):
  . as $value
  | if $schema == true then empty
    elif $schema == false then _problem($path; "is not allowed here")
    elif ($schema | type) != "object" then error("\(_at($path)): a schema must be an object or a boolean")
    else
      ($schema | to_entries[]) as {key: $keyword, value: $op}
      | if $keyword == "type" then
          ([$op] | flatten) as $types
          | if any($types[]; . as $t | $value | _type_matches($t)) then empty
            else _problem($path; "expected \($types | join(" or ")), got \($value | tojson)") end
        elif $keyword == "enum" then
          if ($op | type) != "array" then error("\(_at($path)): enum must be an array")
          elif any($op[]; . == $value) then empty
          else _problem($path; "\($value | tojson) is not one of \($op | map(tojson) | join(", "))") end
        elif $keyword == "const" then
          if $op == $value then empty else _problem($path; "\($value | tojson) is not \($op | tojson)") end
        elif $keyword == "properties" then
          if ($op | type) != "object" then error("\(_at($path)): properties must be an object")
          elif ($value | type) != "object" then empty
          else ($op | to_entries[]) as {key: $k, value: $sub}
            | if $value | has($k) then $value[$k] | _check($sub; _child($path; $k)) else empty end
          end
        elif $keyword == "required" then
          if ($op | type) != "array" then error("\(_at($path)): required must be string[]")
          elif ($value | type) != "object" then empty
          else $op[] as $k | if $value | has($k) then empty else _problem($path; "missing required key \($k | tojson)") end
          end
        elif $keyword == "additionalProperties" then
          if ($value | type) != "object" then empty
          else ($schema.properties // {}) as $declared
            | ($value | to_entries[]) as {key: $k, value: $member}
            | if $declared | has($k) then empty
              elif $op == false then _problem($path; "unknown key \($k | tojson)")
              elif $op == true then empty
              else $member | _check($op; _child($path; $k)) end
          end
        elif $keyword == "items" then
          if ($value | type) != "array" then empty
          else range($value | length) as $i | $value[$i] | _check($op; "\($path)[\($i)]") end
        elif $keyword == "uniqueItems" then
          if $op != true or ($value | type) != "array" then empty
          else range($value | length) as $i
            | select(any(range($i); $value[.] == $value[$i]))
            | _problem($path; "duplicate item \($value[$i] | tojson)")
          end
        elif $keyword == "minItems" then
          if ($op | type) != "number" then error("\(_at($path)): minItems must be a number")
          elif ($value | type) == "array" and ($value | length) < $op then
            _problem($path; "has \($value | length) \(if ($value | length) == 1 then "item" else "items" end), needs at least \($op)")
          else empty end
        elif $keyword == "minLength" then
          if ($op | type) != "number" then error("\(_at($path)): minLength must be a number")
          elif ($value | type) == "string" and ($value | length) < $op then
            _problem($path; if $op == 1 then "must not be empty" else "\($value | tojson) is shorter than \($op) characters" end)
          else empty end
        elif $keyword == "pattern" then
          if ($op | type) != "string" then error("\(_at($path)): pattern must be a string")
          elif ($value | type) == "string" and ($value | test($op) | not) then
            _problem($path; "\($value | tojson) does not match /\($op)/")
          else empty end
        elif $keyword == "format" then
          if $op != "regex" then error("\(_at($path)): format must be \"regex\", the one format enforced here")
          elif ($value | type) != "string" then empty
          elif ($value | _is_regex | not) then
            _problem($path; "\($value | tojson) is not a valid regular expression")
          elif ($value | _not_ere) != null then
            _problem($path; "\($value | tojson) uses \($value | _not_ere), which POSIX ERE lacks; grep -E runs the pattern")
          else empty end
        elif $keyword == "minimum" then
          if ($op | type) != "number" then error("\(_at($path)): minimum must be a number")
          elif ($value | type) == "number" and $value < $op then
            _problem($path; "\($value | tojson) is below the minimum \($op)")
          else empty end
        elif ([$keyword] | inside(_annotations)) then empty
        else error("\(_at($path)): unsupported keyword \($keyword | tojson)") end
    end;

def validate($schema): [_check($schema; "")];
