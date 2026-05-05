const cdk = require('aws-cdk-lib')
const { CncCutListStack } = require('../lib/stack')

const app = new cdk.App()
new CncCutListStack(app, 'CncCutListStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
})
