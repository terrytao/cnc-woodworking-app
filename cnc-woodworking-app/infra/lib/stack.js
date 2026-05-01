const { Stack, CfnOutput, Duration, RemovalPolicy } = require('aws-cdk-lib')
const s3 = require('aws-cdk-lib/aws-s3')
const s3deploy = require('aws-cdk-lib/aws-s3-deployment')
const cloudfront = require('aws-cdk-lib/aws-cloudfront')
const origins = require('aws-cdk-lib/aws-cloudfront-origins')
const lambda = require('aws-cdk-lib/aws-lambda-nodejs')
const lambdaCore = require('aws-cdk-lib/aws-lambda')
const path = require('path')

class CncCutListStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props)

    // Lambda function (esbuild bundles backend/handler.js and its deps)
    const fn = new lambda.NodejsFunction(this, 'CutListHandler', {
      entry: path.join(__dirname, '../../backend/handler.js'),
      handler: 'handler',
      runtime: lambdaCore.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      },
      bundling: {
        minify: true,
        sourceMap: false,
        externalModules: [],
      },
    })

    // Lambda Function URL (no API Gateway needed)
    const fnUrl = fn.addFunctionUrl({
      authType: lambdaCore.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedHeaders: ['content-type'],
        allowedMethods: [lambdaCore.HttpMethod.POST],
      },
    })

    // S3 bucket for frontend assets
    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    // OAI for CloudFront -> S3
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI')
    bucket.grantRead(oai)

    // Strip /api prefix before forwarding to Lambda URL
    const apiRewriteFn = new cloudfront.Function(this, 'ApiRewrite', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  req.uri = req.uri.replace(/^\\/api/, '') || '/';
  return req;
}`)
    })

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(fnUrl.url.replace('https://', '').replace(/\/$/, '')),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [{
            function: apiRewriteFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    })

    // Deploy frontend build to S3 and invalidate CloudFront
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../frontend/dist'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    })

    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` })
    new CfnOutput(this, 'LambdaUrl', { value: fnUrl.url })
  }
}

module.exports = { CncCutListStack }
