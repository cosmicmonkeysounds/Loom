//! Emit the canonical `loom.tmLanguage.json` to stdout:
//!
//! ```bash
//! cargo run -p loom-syntax --bin loom-tmgrammar > loom.tmLanguage.json
//! ```

fn main() {
    print!("{}", loom_syntax::emit_tmgrammar());
}
