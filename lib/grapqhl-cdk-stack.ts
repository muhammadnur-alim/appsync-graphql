import * as cdk from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class GrapqhlCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'GrapqhlCdkQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
    const api = new appsync.GraphqlApi(this, "todo-api", {
      name: "TodoApi",
      definition: appsync.Definition.fromFile("schema/schema.graphql"),
      xrayEnabled: true,
      logConfig: {
        excludeVerboseContent: false,
        fieldLogLevel: appsync.FieldLogLevel.ALL,
      },
    });

    const todoHandler = new nodejs.NodejsFunction(this, "TodoHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda"),
      environment: {
        NODE_ENV: this.node.tryGetContext("env"),
        MONGODB_URL:
          "mongodb+srv://muhammadalim:BbxtygixchoWzcAL@cluster0.57kx0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
      },
    });

    const lambdaDataSource = api.addLambdaDataSource(
      "TodoDataSource",
      todoHandler
    );

    // Create resolvers
    lambdaDataSource.createResolver("GetTodoResolver", {
      typeName: "Query",
      fieldName: "pullTodo",
    });

    lambdaDataSource.createResolver("CreateTodoResolver", {
      typeName: "Mutation",
      fieldName: "pushTodo",
    });

    lambdaDataSource.createResolver("StreamTodoResolver", {
      typeName: "Subscription",
      fieldName: "streamTodo",
    });

    new cdk.CfnOutput(this, "GraphqlTodoApiUrl", {
      value: api.graphqlUrl,
    });

    // Prints out the AppSync GraphQL API key to the terminal
    new cdk.CfnOutput(this, "GraphQLAPIKey", {
      value: api.apiKey || "",
    });

    // Prints out the stack region to the terminal
    new cdk.CfnOutput(this, "Stack Region", {
      value: this.region,
    });
  }
}
