/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./docs/index.html', './docs/app.js'],
  theme: {
    extend: {
      colors: {
        paper: '#fbf7ef',
        sheet: '#fffdf8',
        ink: '#3a342b',
        pencil: '#756b5e',
        rule: '#e5dccb'
      },
      fontFamily: {
        // Nunito 負責數字：LXGW WenKai TC 的 9 容易看成 q
        diary: ['Nunito', '"LXGW WenKai TC"', '"Kaiti TC"', 'DFKai-SB', 'serif']
      }
    }
  }
};
