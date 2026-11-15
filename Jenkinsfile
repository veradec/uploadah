pipeline {
  agent any

  environment {
    AWS_REGION = 'us-east-1' // Use the Region in your ECR URI
    IMAGE_REPO = '991577602166.dkr.ecr.us-east-1.amazonaws.com/jenkins-k8s'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Build Image') {
      steps {
        sh '''
          set -eu
          IMAGE_URI="${IMAGE_REPO}:${BUILD_NUMBER}"
          docker build --pull -t "$IMAGE_URI" .
        '''
      }
    }

    stage('Push Image') {
      steps {
        sh '''
          set -eu
          REGISTRY="${IMAGE_REPO%%/*}"
          IMAGE_URI="${IMAGE_REPO}:${BUILD_NUMBER}"

          aws ecr get-login-password --region "$AWS_REGION" |
            docker login --username AWS --password-stdin "$REGISTRY"

          docker push "$IMAGE_URI"
        '''
      }
    }
  }

  post {
    always {
      sh '''
        REGISTRY="${IMAGE_REPO%%/*}"
        docker logout "$REGISTRY" >/dev/null 2>&1 || true
      '''
    }
  }
}
