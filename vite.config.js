import { defineConfig } from 'vite'

export default defineConfig({
  // 상대 경로 base: './'로 설정하여 GitHub Pages 서브디렉토리 404 문제를 완벽히 해결합니다.
  base: './'
})
