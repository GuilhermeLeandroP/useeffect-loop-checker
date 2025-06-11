const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function isBreakingValue(valueNode) {
  if (!valueNode) return false;

  switch (valueNode.type) {
    case 'BooleanLiteral':
      return valueNode.value === false;
    case 'NullLiteral':
      return true;
    case 'NumericLiteral':
      return valueNode.value === 0;
    case 'StringLiteral':
      return valueNode.value.trim() === '';
    case 'ArrayExpression':
      return valueNode.elements.length === 0;
    case 'Identifier':
      return valueNode.name === 'undefined';
    default:
      return false;
  }
}

function getStateNameFromSetter(setterName) {
  if (!setterName.startsWith('set')) return null;
  const name = setterName.slice(3);
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function analyzeFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');

  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
  } catch (err) {
    console.warn(`"⚠️ Falha ao processar ${filePath}: ${err.message}"`);
    return;
  }

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;

      if (
        (callee.type === 'Identifier' && callee.name === 'useEffect') ||
        (callee.type === 'MemberExpression' && callee.property.name === 'useEffect')
      ) {
        const effectBody = path.node.arguments[0];
        const depsArray = path.node.arguments[1];

        if (!effectBody || !depsArray || depsArray.type !== 'ArrayExpression') return;

        const dependencies = depsArray.elements
          .filter(el => el && el.type === 'Identifier')
          .map(el => el.name);

        if (dependencies.length === 0) return;

        const settersCalled = [];

        path.traverse({
          CallExpression(innerPath) {
            const innerCallee = innerPath.node.callee;
            if (innerCallee.type === 'Identifier' && innerCallee.name.startsWith('set')) {
              const stateName = getStateNameFromSetter(innerCallee.name);
              if (dependencies.includes(stateName)) {
                const args = innerPath.node.arguments;
                const firstArg = args.length > 0 ? args[0] : null;

                settersCalled.push({
                  setterName: innerCallee.name,
                  valueNode: firstArg,
                  loc: innerPath.node.loc.start.line,
                });
              }
            }
          }
        });

        if (settersCalled.length > 0) {
          const anyBreakingValue = settersCalled.some(({ valueNode }) =>
            isBreakingValue(valueNode)
          );

          const useEffectLine = path.node.loc.start.line;

          if (anyBreakingValue) {
            console.log(`"✅ useEffect em ${filePath}:${useEffectLine} — possível loop evitado com valor breaking."`);
            console.log(`"   Dependências: [${dependencies.join(', ')}]"`);
            console.log(
              `"   Setters chamados: ${settersCalled
                .map(s => `${s.setterName}(...) @ linha ${s.loc}`)
                .join(', ')}\n"`
            );
          } else {
            console.log(`"🚨 Loop possível detectado em ${filePath}:${useEffectLine}"`);
            console.log(`"   Dependências: [${dependencies.join(', ')}]"`);
            console.log(
              `"   Setters chamados: ${settersCalled
                .map(s => `${s.setterName}(...) @ linha ${s.loc}`)
                .join(', ')}\n"`
            );
          }
        }
      }
    },
  });
}

function walk(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      walk(fullPath);
    } else if (/\.(jsx?|tsx?)$/.test(file)) {
      analyzeFile(fullPath);
    }
  }
}

const targetPath = process.argv[2];

if (!targetPath) {
  console.log('"❌ Caminho do projeto React não informado."');
  console.log('"✅ Exemplo: node analyze.js ./src"');
  process.exit(1);
}

walk(path.resolve(targetPath));