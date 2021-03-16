const path = require('path')
const {spawn, exec} = require('child_process')
const fs = require('fs-extra')
const ci = require('miniprogram-ci')

const envs = ['dev', 'test', 'mo', 'prod']

class WeappFlow {
  constructor(options = {
    skipBuild: false,
    isExperience: true,
    toolId: '',
    appId: '',
    keyPath: '',
    projectPath: '',
    env: {},
    branch: '',
    outDir: '',
    uploadFunc: null,
    qrcodeImageUrl: '',
    version: '1.0.0',
  }) {
    this.options = options
    this.QRImgUrl = null
  }

  log(...args) {
    console.log('Weapp: ', ...args)
  }

  //拉取分支
  fetchBranch(branch) {
    let _that = this
    this.log('开始拉取分支')
    let _localBranch = branch.slice(15)
    return new Promise((resolve, reject) => {
      exec(`git checkout ${_localBranch} && git pull`, function (err) { 
        if (err == null) {
          _that.log(`拉取分支成功 --- ${branch}`)
          resolve(true)
        } else {
          reject(err)
        }
      })      
    })
  }

  //切换环境
  fetchEnv(env) {
    let _that = this
    this.log(`开始切换环境`)
    return new Promise((resolve, reject) => {
      exec(`yarn env ${env}`, function(err, stdout, stderr) {
        if (err == null) {
          _that.log(`切换环境成功 --- ${env}`)
          resolve(true)
        } else {
          _that.log(err)
          reject(err)
        }
      })
    })
  }

  execBuild(stream) {
    let _that = this
    this.log('开始编译...')
    return new Promise((resolve, reject) => {
      
      const cmd = 'taro build --type weapp'
      const proc = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', cmd.split(' '), {
        env: {
          ...process.env,
          ...this.options.env
        }
      })
      proc.stdout.on('data', data => {
        stream.write(data)
      })

      proc.stderr.on('data', data => {
        stream.write(data)
      })

      proc.on('error', (e) => {
        console.error(`error: ${ e.message }`)
        reject(e)
      })

      proc.on('close', code => {
        if (code !== 0) {
          this.log(`编译失败. ${ logFilePath }`)
          reject(`退出编译阶段: ${ code }`)
        } else {
          this.log('编译成功')
          resolve(true)
        }
      })
    })
  }

  async build() {
    if (this.options.skipBuild) {
      this.log('跳过编译阶段')
      return
    }


    const {
      outDir,
    } = this.options

    
    const logFilePath = path.join(outDir, 'build_wechat.log')
    const stream = fs.createWriteStream(logFilePath)

    return new Promise(async (resolve, reject) => {
      let buildOptioons = process.argv.splice(2)
      if (buildOptioons.length < 2) {
        this.log('请输入完整的分支、环境')
        resolve(false)
        return
      }
      let branch = buildOptioons[0]
      let env = buildOptioons[1]
      if (!envs.includes(env)) {
        this.log('请输入正确的环境')
        resolve(false)
        return
      }
      let isSucc = await this.fetchBranch(branch)
  
      if (!isSucc) {
        this.log('切换分支失败')
        resolve(false)
        return
      }
  
      let envSu = await this.fetchEnv(env)
  
      if (!envSu) {
        this.log('切换环境失败')
        resolve(false)
        return
      }


      let succsess = await this.execBuild(stream)
      resolve(succsess)
    })
  }

  async upload() {
    const {
      keyPath,
      appId,
      projectPath,
      outDir,
      uploadImage,
      version,
      qrcodeImageUrl,
    } = this.options
    if (!fs.existsSync(keyPath)) {
      throw new Error(`${keyPath} 密钥文件不存在`)
    }
    this.log('正在上传...')

    const logFilePath = path.join(outDir, 'upload_wechat.log')
    const stream = fs.createWriteStream(logFilePath)

    const project = new ci.Project({
      appid: appId,
      type: 'miniProgram',
      projectPath: projectPath,
      privateKeyPath: keyPath,
    })

    if (this.options.isExperience) {
      this.log('上传体验版...')
      await ci.upload({
        project,
        version,
        desc: 'auto-upload',
        robot: 1,
        onProgressUpdate(data) {
          stream.write(data.toString() + '\n')
        }
      })
      // 微信体验版地址不会变，直接写死
      this.QRImgUrl = qrcodeImageUrl
    } else {
      this.log('上传预览版...')
      const qrcodeOutputDest = path.join(outDir, 'wechat-preview.jpg')
      await ci.preview({
        project,
        desc: 'Uploaded by taro-deploy',
        qrcodeFormat: 'image',
        qrcodeOutputDest,
        onProgressUpdate(data) {
          stream.write(data.toString() + '\n')
        }
      })
      if (uploadImage) {
        this.QRImgUrl = await uploadImage(`weapp-preview-${Date.now()}.jpg`, qrcodeOutputDest)
      } else {
        this.log(`未提供 uploadImage 函数，无法在钉钉中嵌入二维码图片。预览版二维码图片保存在${qrcodeOutputDest}`)
      }
    }

    this.log('上传完成')
  }

  async run () {
    let res = await this.build()
    if (res) {
      await this.upload()
      return this.QRImgUrl
    }
  }
}

module.exports = WeappFlow
