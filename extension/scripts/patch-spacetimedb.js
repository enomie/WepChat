import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stdbDir = path.resolve(__dirname, '../node_modules/spacetimedb');

if (!fs.existsSync(stdbDir)) {
  console.log('[patch-stdb] spacetimedb not found in node_modules, skipping.');
  process.exit(0);
}

const filesToPatch = [
  path.join(stdbDir, 'dist/index.browser.mjs'),
  path.join(stdbDir, 'dist/index.mjs'),
  path.join(stdbDir, 'src/lib/algebraic_type.ts'),
];

for (const filePath of filesToPatch) {
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Remove WebSocket dynamicImport with new Function
  content = content.replace(
    /const dynamicImport = new Function\("m", "return import\(m\)"\);/g,
    'const dynamicImport = () => Promise.reject(new Error("Chrome Extension CSP: dynamic import forbidden"));'
  );

  // 2. Patch ProductType serializer & deserializer
  // Replace makeSerializer Function codegen
  content = content.replace(
    /if \(isFixedSizeProduct\(ty\)\) \{[\s\S]*?SERIALIZERS\.set\(ty, serializer\);[\s\S]*?return serializer;\s*\}\s*const serializers = \{\};[\s\S]*?serializer = Function\("writer", "value", body\)\.bind\([\s\S]*?serializers[\s\S]*?\);\s*SERIALIZERS\.set\(ty, serializer\);/,
    `const serializers = {};
    const fieldNames = ty.elements.map(e => e.name);
    serializer = (writer, value) => {
      for (let i = 0; i < fieldNames.length; i++) {
        const name = fieldNames[i];
        serializers[name](writer, value[name]);
      }
    };
    SERIALIZERS.set(ty, serializer);`
  );

  // Replace makeDeserializer Function codegen
  content = content.replace(
    /if \(isFixedSizeProduct\(ty\)\) \{[\s\S]*?DESERIALIZERS\.set\(ty, deserializer\);[\s\S]*?return deserializer;\s*\}\s*const deserializers = \{\};[\s\S]*?deserializer = Function\([\s\S]*?"reader",[\s\S]*?\)\.bind\(deserializers\);\s*DESERIALIZERS\.set\(ty, deserializer\);/,
    `const deserializers = {};
    const fieldNames = ty.elements.map(e => e.name);
    deserializer = (reader) => {
      const result = {};
      for (let i = 0; i < fieldNames.length; i++) {
        const name = fieldNames[i];
        result[name] = deserializers[name](reader);
      }
      return result;
    };
    DESERIALIZERS.set(ty, deserializer);`
  );

  // 3. Patch SumType serializer & deserializer
  content = content.replace(
    /const serializers = \{\};\s*const body = `switch \(value\.tag\) \{[\s\S]*?`;\s*serializer = Function\("writer", "value", body\)\.bind\([\s\S]*?serializers[\s\S]*?\);\s*SERIALIZERS\.set\(ty, serializer\);/,
    `const serializers = {};
      const tagToIndices = {};
      for (let i = 0; i < ty.variants.length; i++) {
        tagToIndices[ty.variants[i].name] = i;
      }
      serializer = (writer, value) => {
        const tag = value.tag;
        const index = tagToIndices[tag];
        if (index === undefined) {
          throw new TypeError(\`Could not serialize sum type; unknown tag \${tag}\`);
        }
        writer.writeByte(index);
        serializers[tag](writer, value.value);
      };
      SERIALIZERS.set(ty, serializer);`
  );

  content = content.replace(
    /const deserializers = \{\};\s*deserializer = Function\([\s\S]*?"reader",[\s\S]*?`switch \(reader\.readU8\(\)\) \{[\s\S]*?`\s*\)\.bind\(deserializers\);\s*DESERIALIZERS\.set\(ty, deserializer\);/,
    `const deserializers = {};
      const indexToNames = ty.variants.map((v) => v.name);
      deserializer = (reader) => {
        const index = reader.readU8();
        const tag = indexToNames[index];
        if (tag === undefined) {
          throw new TypeError(\`Could not deserialize sum type; unknown index \${index}\`);
        }
        return { tag, value: deserializers[tag](reader) };
      };
      DESERIALIZERS.set(ty, deserializer);`
  );

  fs.writeFileSync(filePath, content, 'utf8');
}

console.log('[patch-stdb] Successfully applied CSP-safe serialization to spacetimedb.');
