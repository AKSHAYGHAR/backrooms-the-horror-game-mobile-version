const fs = require('fs');
const path = require('path');
const buffer = fs.readFileSync(path.join(__dirname, 'public/models/pennywise.glb'));
const chunk0Length = buffer.readUInt32LE(12);
const jsonStr = buffer.toString('utf8', 20, 20 + chunk0Length);
const gltf = JSON.parse(jsonStr);

console.log("=== MESHES ===");
gltf.meshes.forEach((mesh, index) => {
    console.log(`[Mesh ${index}] Name: ${mesh.name}`);
    if (mesh.primitives) {
        mesh.primitives.forEach(prim => {
            const mat = gltf.materials[prim.material];
            console.log(`  - Material: ${mat ? mat.name : 'None'}`);
        });
    }
});

console.log("\n=== MATERIALS ===");
gltf.materials.forEach((mat, index) => {
    console.log(`[Material ${index}] Name: ${mat.name}`);
});
