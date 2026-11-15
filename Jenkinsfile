pipeline {
  agent any

  environment {
    IMAGE_NAME = "video-approval-app"
    IMAGE_TAG = "${env.BUILD_NUMBER}"
    REGISTRY = "your-registry.example.com"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install') {
      steps {
        sh 'npm ci || npm install'
      }
    }

    stage('Build Image') {
      steps {
        sh 'docker build -t $IMAGE_NAME:$IMAGE_TAG .'
      }
    }

    stage('Push Image') {
      when {
        expression { return env.BRANCH_NAME == 'main' }
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'registry-creds', usernameVariable: 'REG_USER', passwordVariable: 'REG_PASS')]) {
          sh '''
            echo "$REG_PASS" | docker login "$REGISTRY" -u "$REG_USER" --password-stdin
            docker tag "$IMAGE_NAME:$IMAGE_TAG" "$REGISTRY/$IMAGE_NAME:$IMAGE_TAG"
            docker push "$REGISTRY/$IMAGE_NAME:$IMAGE_TAG"
          '''
        }
      }
    }
  }

  post {
    always {
      sh 'docker logout $REGISTRY || true'
    }
  }
}
