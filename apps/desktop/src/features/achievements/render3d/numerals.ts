import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { DIGIT_OUTLINES, DIGIT_UNITS_PER_EM } from "./digits";

/**
 * Flat shapes for a run of digits in Pretendard Bold, centred on the origin,
 * scaled so the digits stand height units tall and no wider than maxWidth.
 */
export function numeralShapes(text: string, height: number, maxWidth: number): THREE.Shape[] {
  const loader = new SVGLoader();
  const shapes: THREE.Shape[] = [];
  let pen = 0;
  const tracking = -40;
  for (const letter of text) {
    const outline = DIGIT_OUTLINES[letter];
    if (!outline) continue;
    const data = loader.parse('<svg xmlns="http://www.w3.org/2000/svg"><path d="' + outline.d + '"/></svg>');
    for (const path of data.paths) {
      for (const shape of SVGLoader.createShapes(path)) {
        shapes.push(offsetShape(shape, pen));
      }
    }
    pen += outline.advance + tracking;
  }
  const digitHeight = 1450;
  const scale = Math.min(height / digitHeight, maxWidth / Math.max(pen - tracking, 1));
  const box = new THREE.Box2();
  shapes.forEach((shape) => shape.getPoints().forEach((point) => box.expandByPoint(point)));
  const centre = box.getCenter(new THREE.Vector2());
  return shapes.map((shape) => transformShape(shape, (point) => new THREE.Vector2((point.x - centre.x) * scale, (point.y - centre.y) * scale)));
}

function offsetShape(shape: THREE.Shape, dx: number): THREE.Shape {
  return transformShape(shape, (point) => new THREE.Vector2(point.x + dx, point.y));
}

function transformShape(shape: THREE.Shape, map: (point: THREE.Vector2) => THREE.Vector2): THREE.Shape {
  const out = new THREE.Shape(shape.getPoints(8).map(map));
  out.holes = shape.holes.map((hole) => new THREE.Path(hole.getPoints(8).map(map)));
  return out;
}

export const NUMERAL_EM = DIGIT_UNITS_PER_EM;
