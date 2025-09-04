export class Vector2 {
  constructor(public x = 0, public y = 0) { }

  clone() {
    return new Vector2(this.x, this.y);
  }

  set(x: Vector2['x'], y: Vector2['y']) {
    this.x = x;
    this.y = y;
  }

  add(v: Vector2) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  sub(v: Vector2) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  scale(s: number) {
    this.x *= s;
    this.y *= s;
    return this;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  normalize() {
    const len = this.length();
    if (len > 0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }
}
