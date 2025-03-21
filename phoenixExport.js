/**
 * javascript code to export a ROOT geometry to GLTF
 *
 * Main supported features :
 *   - able to cleanup the geometry by dropping all subtrees of a given list
 *   - able to split the geometry into pieces and match them to the hierarchical menu in phoenix
 *   - supports default opacity and visibility for each piece
 *   - simplifies the geometry for spheres and cones to avoid too many faces
 *   - deduplicate materials in the resulting gltf file
 */

/// checks whether a name matches one of the given paths
function matches(name, paths) {
    for (const path of paths) {
        if (typeof(path) == "string") {
            if (name.startsWith(path)) {
                return true;
            }
        } else { // needs to be a regexp
            if (name.match(path)) {
                return true;
            }
        }
    }
    return false;
}

/// filters an array in place
function filterArrayInPlace(a, condition, thisArg) {
    var j = 0;
    a.forEach((e, i) => { 
        if (condition.call(thisArg, e, i, a)) {
            if (i!==j) a[j] = e; 
            j++;
        }
    });
    a.length = j;
    return a;
}

/**
 * cleans up the geometry in node by dropping all subtress whose path starts with
 * one of the hidden_paths and all nodes byond a given level
 */
function cleanup_geometry(node, hidden_paths, max_level=999, level = 0) {
    if (node.fVolume.fNodes) {
        // drop hidden nodes, and everything after level max_level
        filterArrayInPlace(node.fVolume.fNodes.arr, n=>level<max_level&&!matches(n.fName, hidden_paths));
        // recurse to children
        for (const snode of node.fVolume.fNodes.arr) {
            cleanup_geometry(snode, hidden_paths, max_level, level + 1);
        }
    }
}

function forceDisplay() {
    return new Promise(resolve => setTimeout(resolve, 0));
}
/// deduplicates identical materials in the given gltf file
/// deduplicates identical materials in the given gltf file
async function deduplicate(gltf, body) {
    // Add a safety check for materials existence
    if (!gltf || !gltf.materials || !Array.isArray(gltf.materials)) {
        body.innerHTML += "<h3>Materials</h3>"
        body.innerHTML += "No materials found or materials is not an array. Skipping material deduplication.<br/>"
        await forceDisplay();
        return gltf;
    }
    
    // deduplicate materials
    body.innerHTML += "<h3>Materials</h3>"
    await forceDisplay()
    // scan them, build table of correspondance
    var kept = []
    var links = {}
    var materials = gltf["materials"];
    body.innerHTML += "initial number of materials : " + materials.length + "</br>"
    await forceDisplay()
    for (var index = 0; index < materials.length; index++) {
        var found = false;
        for (var kindex = 0; kindex < kept.length; kindex++) {
            if (JSON.stringify(kept[kindex]) == JSON.stringify(materials[index])) {
                links[index] = kindex;
                found = true;
                break;
            }
        }
        if (!found) {
            links[index] = kept.length;
            kept.push(materials[index]);
        }
    }
    // now rewrite the materials table and fix the meshes
    gltf["materials"] = kept;
    
    // Add safety check for meshes
    if (gltf.meshes && Array.isArray(gltf.meshes)) {
        for (const mesh of gltf["meshes"]) {
            if (mesh.primitives && Array.isArray(mesh.primitives)) {
                for(const primitive of mesh["primitives"]) {
                    if ("material" in primitive) {
                        primitive["material"] = links[primitive["material"]];
                    }
                }
            }
        }
    }
    
    body.innerHTML += "new number of materials : " + gltf["materials"].length + "</br>"
    
    // deduplicate meshes - with safety checks
    if (gltf.meshes && Array.isArray(gltf.meshes)) {
        body.innerHTML += "<h3>Meshes</h3>"
        body.innerHTML += "initial number of meshes/accessors : " + gltf.meshes.length + "/" + (gltf.accessors ? gltf.accessors.length : "N/A") + "</br>"
        await forceDisplay()
        kept = []
        links = {}
        for (var index = 0; index < gltf.meshes.length; index++) {
            var found = false;
            for (var kindex = 0; kindex < kept.length; kindex++) {
                if (JSON.stringify(kept[kindex]) == JSON.stringify(gltf.meshes[index])) {
                    links[index] = kindex;
                    found = true;
                    break;
                }
            }
            if (!found) {
                links[index] = kept.length;
                kept.push(gltf.meshes[index]);
            }
        }
        // now rewrite the meshes table and fix the nodes
        gltf.meshes = kept;
        body.innerHTML += "new number of meshes/accessors : " + gltf.meshes.length + "/" + (gltf.accessors ? gltf.accessors.length : "N/A") + "</br>"
        await forceDisplay()
    } else {
        body.innerHTML += "<h3>Meshes</h3>"
        body.innerHTML += "No meshes found or meshes is not an array. Skipping mesh deduplication.<br/>"
    }

    let json = JSON.stringify(gltf)
    json = json.replace(/"mesh":([0-9]+)/g, function(a,b) {
        return `"mesh":${links[parseInt(b)]}`
    })
    return JSON.parse(json)
}

/// convert given geometry to GLTF
async function convert_geometry(obj3d, name, body) {
    body.innerHTML += "<h2>Exporting to GLTF</h2>"
    await forceDisplay()
    const exporter = new THREE.GLTFExporter;
    let gltf = await new Promise((resolve, reject) =>
        exporter.parse(obj3d, resolve, reject, {'binary':false})
    )
    // json output
    body.innerHTML += "<h2>Deduplicating data in GLTF</h2>"    
    await forceDisplay()
    gltf = await deduplicate(gltf, body);
    const fileToSave = new Blob([JSON.stringify(gltf)], {
        type: 'application/json',
        name: name
    });
    saveAs(fileToSave, name);
}

var kVisThis = 0x80;
var kVisDaughter = 0x8;

// goes recursively through shape and sets the number of segments for spheres
function fixSphereShapes(shape) {
    // in case of sphere, do the fix
    if (shape._typename == "TGeoSphere") {
        shape.fNseg = 3;
        shape.fNz = 3;
    }
    // in case of composite shape, recurse
    if (shape._typename == "TGeoCompositeShape") {
        fixSphereShapes(shape.fNode.fLeft)
        fixSphereShapes(shape.fNode.fRight)
    }
}

// makes given node visible
function setVisible(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt | kVisThis);
    // Change the number of faces for sphere so that we avoid having
    // megabytes for the Rich mirrors, which are actually almost flat
    // Default was 20 and 11
    fixSphereShapes(node.fVolume.fShape)
}
// makes given node's daughters visible
function setVisibleDaughter(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt | kVisDaughter);
}
// makes given node invisible
function setInvisible(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt & ~kVisThis);
}
// makes given node and all its children recursively visible
function set_visible_recursively(node) {
    setVisible(node);
    if (node.fVolume.fNodes) {
        for (var j = 0; j < node.fVolume.fNodes.arr.length; j++) {
            var snode = node.fVolume.fNodes.arr[j];
            set_visible_recursively(snode);
        }
    }
}
// makes given node and all its children recursively invisible
function set_invisible_recursively(node) {
    setInvisible(node);
    if (node.fVolume.fNodes) {
        for (var j = 0; j < node.fVolume.fNodes.arr.length; j++) {
            var snode = node.fVolume.fNodes.arr[j];
            set_invisible_recursively(snode);
        }
    }
}

/**
 * make only the given paths visible in a geometry and returns
 * whether anything at all is visible
 */
function keep_only_subpart(volume, paths) {
    if (!volume.fNodes) return false;
    var anyfound = false;
    for (var j = 0; j < volume.fNodes.arr.length; j++) {
        var snode = volume.fNodes.arr[j];
        if (matches(snode.fName, paths)) {
            // need to be resursive in case something deeper was hidden in previous round
            set_visible_recursively(snode);
            anyfound=true;
        } else {
            // make daughers visible if a subpart is shown
            var subpartfound = keep_only_subpart(snode.fVolume, paths);
            if (subpartfound) {
                setVisibleDaughter(snode);
                anyfound = true;
            }
        }
    }
    return anyfound;
}

/**
 * Removes children nodes that are not matching paths
 * these should never have been created, but jsRoot has limitations and may create
 * unwanted children in cases where the smae logical volume is shared by several physical
 * volumes out of which some should be visible and others not.
 * Root is never checking the flags of the physical volumes, only of the logical one,
 * creating this situation
 */
function cleanupChildren(child, paths) {
    // check all children and call ourselves recursively when we keep one
    filterArrayInPlace(child.children, n=>n.name==''||matches(n.name, paths));
    for (var n = 0; n < child.children.length; n++) {
        cleanupChildren(child.children[n], paths);
    }
}

/**
 * Convert a given geometry to the gltf file
 * @parameter obj the input geometry
 * @parameter filename the name of the resulting file
 * @parameter max_level maximum depth to convert. Anything below will be discarded
 * @parameter hide_children array of paths prefix for nodes that should be ignored
 * @parameter subparts definition of the subparts to create in the geometry
 * @parameter body the body tag of the page, for writing log to it
 * 
 * subparts is a dictionnary with
 *   - key being the path of the subpart in the phoenix menu, with ' > ' as separator
 *     for the different levels, e.g. "a > b > c" will be entry c in submenu b of menu a
 *   - value being an array of 2 items :
 *      + an array of paths to consider for thea part
 *      + a boolean or a float between 0 and 1 defining the default visibility of the part
 *        false means not visible, true means visible, float means visible with that opacity
 */
async function internal_convert_geometry(obj, filename, max_level, subparts, hide_children, body, nFaces) {
    const geo = await JSROOT.require('geom')
    const scenes = [];
    // for each geometry subpart, duplicate the geometry and keep only the subpart
    body.innerHTML += "<h2>Generating all scenes (one per subpart)</h2>"
    await forceDisplay()

    for (const [name, entry] of Object.entries(subparts)) {
        body.innerHTML += "  " + name + "</br>"
        await forceDisplay()
        // drop nodes we do not want to see at all (usually too detailed parts)
        cleanup_geometry(obj.fNodes.arr[0], hide_children, max_level);
        // dump to gltf, using one scene per subpart
        // set nb of degrees per face for circles approximation to nFaces
        geo.geoCfg('GradPerSegm', 360/nFaces);
        const paths = entry[0];
        const visibility = entry[1];
        // extract subpart of ROOT geometry
        // first reset visibility to be sure eveything is invisible
        set_invisible_recursively(obj.fNodes.arr[0])
        // make top node visible
        setVisible(obj.fNodes.arr[0]);
        keep_only_subpart(obj.fMasterVolume, paths);
        // convert to gltf
        var scene = new THREE.Scene();
        scene.name = name;
        var children = geo.build(obj, {dflt_colors: true, vislevel:10, numfaces: 10000000, numnodes: 500000});
        // remove from children paths that should not be there
        cleanupChildren(children, paths)
        scene.children.push( children );
        if (typeof visibility == "boolean") {
            scene.userData = {"visible" : visibility};
        } else {
            scene.userData = {"visible" : true, "opacity" : visibility};
        }
        scenes.push(scene);

        // Suppose 'entry' is the subpart definition array
        let color = null;
        if (Array.isArray(entry) && entry.length > 2)
        color = entry[2];
        if (color !== null) {
        scene.traverse(function(node) {
            if (node.isMesh) {
                node.material = node.material.clone();
                node.material.color.setHex(color);
            }
        });
        }


    }




    
    body.innerHTML += '</br>' + scenes.length + ' scenes generated</br>';
    await forceDisplay()
    //await convert_geometry(scenes, filename, body);}
    if (scenes.length === 0) {
        logFn("No scenes were generated, conversion failed");
        return;
      }
      
      // Create a parent group to hold all subpart scenes and give it a name.
      let parentGroup = new THREE.Group();
      parentGroup.name = "SiD Geometry";
      for (const scene of scenes) {
        // Ensure each subpart scene has its custom name.
        scene.name = scene.name || "Unnamed Subpart";
        parentGroup.add(scene);
      }
      
      // Now export the parentGroup rather than the raw scenes array.
      await convert_geometry(parentGroup, filename, body);}



async function convertGeometry(inputFile, outputFile, max_level, subparts, hide_children, objectName = "Default", nFaces = 24) {
    const body = document.body
    body.innerHTML = "<h1>Converting ROOT geometry to GLTF</h1>Input file : " + inputFile + "</br>Output file : " + outputFile + "</br>Reading input..." 
    const file = await JSROOT.openFile(inputFile)
    const obj = await file.readObject(objectName + ";1")
    await internal_convert_geometry(obj, outputFile, max_level, subparts, hide_children, body, nFaces)
    body.innerHTML += "<h1>Convertion succeeded !</h1>"
}

export {convertGeometry};